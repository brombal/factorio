import { beltStyles, iconFiles, itemColors, preferredRecipes, wikiIcon } from "./overrides.ts";
import type { BeltTier, Item, Machine, Module, ProductionData, Recipe } from "./types.ts";
import vanilla from "./vanilla.json" with { type: "json" };

// The generated file is written by scripts/importVanilla.ts in this project's shape, minus icons
// and the hand-picked styling in overrides.ts.
const generated = vanilla as unknown as {
  version: string;
  items: Omit<Item, "icon">[];
  recipes: Recipe[];
  machines: Omit<Machine, "icon">[];
  belts: Omit<BeltTier, "icon" | "shortName" | "color">[];
  modules: Omit<Module, "icon">[];
};

const iconFor = (entry: { id: string; name: string }) =>
  wikiIcon(iconFiles[entry.id] ?? entry.name.replace(/ /g, "_"));

/** Vanilla Factorio 2.0, imported from FactorioLab's dataset, with icons and hand-picked colors. */
export const vanillaData: ProductionData = {
  items: Object.fromEntries(
    generated.items.map((item) => [
      item.id,
      { ...item, icon: iconFor(item), color: itemColors[item.id] ?? item.color },
    ]),
  ),
  recipes: Object.fromEntries(generated.recipes.map((recipe) => [recipe.id, recipe])),
  machines: generated.machines.map((machine) => ({ ...machine, icon: iconFor(machine) })),
  belts: generated.belts.map((belt) => ({
    ...belt,
    icon: iconFor(belt),
    shortName: beltStyles[belt.id]?.shortName ?? belt.name,
    color: beltStyles[belt.id]?.color ?? "oklch(0.75 0.05 90)",
  })),
  modules: generated.modules.map((module) => ({ ...module, icon: iconFor(module) })),
  preferredRecipes,
};

export const gameVersion = generated.version;
