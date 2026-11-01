import type {
  CraftingCategory,
  ExtractionCategory,
  Machine,
  ProductionData,
} from "../data/types.ts";

export type MachineGroup = CraftingCategory | ExtractionCategory;

/**
 * Which modules fill every machine that has slots. "mixed" puts productivity where a recipe
 * allows it and speed everywhere else.
 */
export type ModuleChoice = "none" | "speed" | "productivity" | "mixed";
export const moduleChoices: ModuleChoice[] = ["none", "speed", "productivity", "mixed"];

/** The machine and belt tiers the player builds with, which the chart's counts assume. */
export interface BuildPreferences {
  /** Preferred machine id for each machine group, keyed by the category the machine runs. */
  machines: Partial<Record<MachineGroup, string>>;
  belt: string;
  modules: ModuleChoice;
  /** Module tier, 1 to 3, used for whichever modules are chosen. */
  moduleTier: number;
}

const storageKey = "factorio-bus:build-preferences";

// Mid-game picks: what most players have once a main bus is worth planning.
const defaultIds: { machines: Partial<Record<MachineGroup, string>>; belt: string } = {
  machines: {
    mining: "electric-mining-drill",
    smelting: "steel-furnace",
    crafting: "assembling-machine-2",
  },
  belt: "fast-transport-belt",
};

/** Machine groups in the order their first machine appears in the data. */
export function machineGroups(data: ProductionData): MachineGroup[] {
  return [...new Set(data.machines.flatMap((machine) => machine.categories))];
}

/**
 * Reads saved preferences, keeping only ids that still exist in the data and filling the rest
 * with defaults (or the lowest tier when a default is missing).
 */
export function loadBuildPreferences(data: ProductionData): BuildPreferences {
  let saved: Partial<BuildPreferences> = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    // Storage can be unavailable or hold garbage; defaults are fine either way.
  }
  const machines: BuildPreferences["machines"] = {};
  for (const group of machineGroups(data)) {
    const candidates = data.machines.filter((machine) => machine.categories.includes(group));
    const wanted = [saved.machines?.[group], defaultIds.machines[group]];
    machines[group] =
      wanted.find((id) => candidates.some((machine) => machine.id === id)) ?? candidates[0]?.id;
  }
  const beltIds = [saved.belt, defaultIds.belt];
  const belt =
    beltIds.find((id) => data.belts.some((tier) => tier.id === id)) ?? data.belts[0]?.id ?? "";
  const modules = moduleChoices.includes(saved.modules as ModuleChoice)
    ? (saved.modules as ModuleChoice)
    : "none";
  const tiers = new Set(data.modules.map((module) => module.tier));
  const moduleTier = tiers.has(saved.moduleTier ?? 0) ? (saved.moduleTier ?? 1) : 1;
  return { machines, belt, modules, moduleTier };
}

export function saveBuildPreferences(preferences: BuildPreferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Not persisting is acceptable; the choice still applies for this visit.
  }
}

export const isPreferredMachine = (preferences: BuildPreferences, machine: Machine) =>
  Object.values(preferences.machines).includes(machine.id);
