import type { Machine, Module, ProductionData, Recipe, RecipeId } from "../data/types.ts";
import type { BuildPreferences } from "./buildPreferences.ts";

/** The modules a machine is filled with and what they add up to. */
export interface MachineModules {
  module?: Module;
  count: number;
  /** Factor on the machine's base speed, never below 0.2 as in the game. */
  speedMultiplier: number;
  /** Extra output as a fraction of normal output. */
  productivity: number;
}

const noModules: MachineModules = { count: 0, speedMultiplier: 1, productivity: 0 };

/**
 * What the player's module choice puts in one machine running a recipe, or mining when no
 * recipe is given (drills take productivity). Every slot holds the same module.
 */
export function machineModules(
  data: ProductionData,
  preferences: BuildPreferences,
  machine: Machine,
  recipe?: Recipe,
): MachineModules {
  const allowsProductivity = recipe ? recipe.allowProductivity : true;
  const choice = preferences.modules;
  const kind =
    choice === "speed" || (choice === "mixed" && !allowsProductivity)
      ? "speed"
      : (choice === "productivity" || choice === "mixed") && allowsProductivity
        ? "productivity"
        : undefined;
  const module = data.modules.find(
    (candidate) => candidate.kind === kind && candidate.tier === preferences.moduleTier,
  );
  if (!module || machine.moduleSlots === 0) return noModules;
  const count = machine.moduleSlots;
  return {
    module,
    count,
    speedMultiplier: Math.max(0.2, 1 + count * module.speed),
    productivity: count * module.productivity,
  };
}

/** The productivity bonus each recipe gets in the player's chosen machine for its category. */
export function recipeProductivity(
  data: ProductionData,
  preferences: BuildPreferences,
): Map<RecipeId, number> {
  const bonuses = new Map<RecipeId, number>();
  for (const recipe of Object.values(data.recipes)) {
    const machine = data.machines.find(
      (candidate) => candidate.id === preferences.machines[recipe.craftingCategory],
    );
    if (!machine) continue;
    const { productivity } = machineModules(data, preferences, machine, recipe);
    if (productivity > 0) bonuses.set(recipe.id, productivity);
  }
  return bonuses;
}
