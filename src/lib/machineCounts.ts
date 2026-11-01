import type { ItemId, Machine, ProductionData, RecipeId } from "../data/types.ts";
import type { BuildPreferences } from "./buildPreferences.ts";
import type { Flow } from "./computeFlow.ts";
import { type MachineModules, machineModules } from "./moduleEffects.ts";

export interface MachineCount {
  machine: Machine;
  /** Machines running flat out to meet demand; build the next whole number up. */
  count: number;
  /** The modules each of these machines holds. */
  modules: MachineModules;
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
      return { machine, modules, count: (crafts * recipe.time) / speed };
    });
}

/**
 * How many of each drill type it takes to mine a raw item at the rate the flow demands.
 * Productivity in a drill raises its output, so it lowers the drill count, not the ore rate.
 */
export function miningDrillCounts(
  data: ProductionData,
  flow: Flow,
  item: ItemId,
  preferences: BuildPreferences,
): MachineCount[] {
  const miningTime = data.items[item]?.miningTime;
  // Pumped items are counted in pumpjacks and offshore pumps, not drills.
  if (miningTime === undefined || data.items[item]?.extraction) return [];
  const rate = flow.itemRate.get(item) ?? 0;
  return data.machines
    .filter((machine) => machine.categories.includes("mining"))
    .map((machine) => {
      const modules = machineModules(data, preferences, machine);
      const perDrill = machine.speed * modules.speedMultiplier * (1 + modules.productivity);
      return { machine, modules, count: (rate * miningTime) / perDrill };
    });
}
