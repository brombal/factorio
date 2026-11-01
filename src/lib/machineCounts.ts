import type {
  ExtractionCategory,
  Item,
  ItemId,
  Machine,
  ProductionData,
  RecipeId,
} from "../data/types.ts";
import type { BuildPreferences } from "./buildPreferences.ts";
import type { Flow } from "./computeFlow.ts";
import { type MachineModules, machineModules } from "./moduleEffects.ts";

export interface MachineCount {
  machine: Machine;
  /** Machines running flat out to meet demand; build the next whole number up. */
  count: number;
  /** The modules each of these machines holds. */
  modules: MachineModules;
  /** Whether this is the machine the player chose to build for this recipe or resource. */
  chosen: boolean;
}

/**
 * How many of each capable machine it takes to meet the flow's demand on a recipe, each tier
 * with its own modules: crafts per second times seconds per craft gives the work needed at
 * speed 1, divided by the machine's speed with modules.
 */
export function recipeMachineCounts(
  data: ProductionData,
  flow: Flow,
  recipeId: RecipeId,
  preferences: BuildPreferences,
): MachineCount[] {
  const recipe = data.recipes[recipeId];
  // The flow ran with the chosen machine's productivity; another tier with different slots
  // needs a different number of crafts for the same output.
  const output =
    (flow.recipeCrafts.get(recipeId) ?? 0) * (1 + (flow.productivity.get(recipeId) ?? 0));
  return data.machines
    .filter((machine) => machine.categories.includes(recipe.craftingCategory))
    .map((machine) => {
      const modules = machineModules(data, preferences, machine, recipe);
      const crafts = output / (1 + modules.productivity);
      const speed = machine.speed * modules.speedMultiplier;
      return {
        machine,
        modules,
        count: (crafts * recipe.time) / speed,
        chosen: preferences.machines[recipe.craftingCategory] === machine.id,
      };
    });
}

/** The kind of machine that extracts a raw item, or undefined for gathered items such as wood. */
export const extractionOf = (item: Item | undefined): ExtractionCategory | undefined =>
  item?.extraction ?? (item?.miningTime === undefined ? undefined : "mining");

/**
 * How many of each extracting machine it takes to supply a raw item at the rate the flow
 * demands: drills for ores, pumpjacks for crude oil, offshore pumps for water. Productivity
 * raises a machine's output, so it lowers the count, not the item's rate. A pumpjack's output
 * also scales with the yield of its oil field, taken from the player's average.
 */
export function extractionCounts(
  data: ProductionData,
  flow: Flow,
  item: ItemId,
  preferences: BuildPreferences,
): MachineCount[] {
  const category = extractionOf(data.items[item]);
  const miningTime = data.items[item]?.miningTime;
  if (!category || miningTime === undefined) return [];
  const rate = flow.itemRate.get(item) ?? 0;
  const fieldYield = category === "fluid-extraction" ? preferences.pumpjackYield / 100 : 1;
  return data.machines
    .filter((machine) => machine.categories.includes(category))
    .map((machine) => {
      const modules = machineModules(data, preferences, machine);
      const perMachine =
        machine.speed * modules.speedMultiplier * (1 + modules.productivity) * fieldYield;
      return {
        machine,
        modules,
        count: (rate * miningTime) / perMachine,
        chosen: preferences.machines[category] === machine.id,
      };
    });
}
