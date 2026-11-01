// Hand-maintained additions to the imported vanilla data: what the dataset does not carry or
// what reads better chosen by hand. The import script and the data loader both read this file.

/** Hand-picked line colors, bright but muted, for items where the icon's average color misleads. */
export const itemColors: Record<string, string> = {
  "iron-ore": "oklch(0.72 0.07 245)",
  "copper-ore": "oklch(0.72 0.12 45)",
  coal: "oklch(0.70 0.01 260)",
  stone: "oklch(0.76 0.05 70)",
  "iron-plate": "oklch(0.82 0.02 240)",
  "copper-plate": "oklch(0.76 0.13 55)",
  "stone-brick": "oklch(0.70 0.08 50)",
  "steel-plate": "oklch(0.78 0.05 215)",
  "iron-gear-wheel": "oklch(0.74 0.03 200)",
  "copper-cable": "oklch(0.82 0.10 70)",
  "electronic-circuit": "oklch(0.80 0.15 135)",
  "iron-stick": "oklch(0.76 0.02 90)",
  "transport-belt": "oklch(0.84 0.15 92)",
  inserter: "oklch(0.78 0.13 75)",
  "firearm-magazine": "oklch(0.74 0.09 60)",
  "automation-science-pack": "oklch(0.70 0.17 25)",
  "logistic-science-pack": "oklch(0.76 0.15 150)",
  "piercing-rounds-magazine": "oklch(0.68 0.14 30)",
  grenade: "oklch(0.64 0.08 145)",
  "stone-wall": "oklch(0.74 0.03 80)",
  "military-science-pack": "oklch(0.70 0.03 280)",
  "electric-mining-drill": "oklch(0.72 0.06 200)",
  "assembling-machine-1": "oklch(0.76 0.04 90)",
  "steel-furnace": "oklch(0.70 0.06 40)",
  lab: "oklch(0.74 0.06 220)",
  splitter: "oklch(0.82 0.12 95)",
  "underground-belt": "oklch(0.78 0.11 80)",
  "fast-transport-belt": "oklch(0.68 0.16 25)",
  "fast-inserter": "oklch(0.70 0.11 250)",
  "long-handed-inserter": "oklch(0.66 0.15 15)",
  "medium-electric-pole": "oklch(0.70 0.07 50)",
  rail: "oklch(0.72 0.02 250)",
  "gun-turret": "oklch(0.76 0.10 75)",
  water: "oklch(0.72 0.10 235)",
  "crude-oil": "oklch(0.66 0.04 60)",
  "heavy-oil": "oklch(0.68 0.13 40)",
  "light-oil": "oklch(0.80 0.13 80)",
  "petroleum-gas": "oklch(0.72 0.09 320)",
  lubricant: "oklch(0.74 0.13 145)",
  "sulfuric-acid": "oklch(0.82 0.14 110)",
};

/**
 * The recipe each item is made with by default where it has several, when the dataset's first
 * one is not what most players build.
 */
export const preferredRecipes: Record<string, string> = {
  "petroleum-gas": "advanced-oil-processing",
  "solid-fuel": "solid-fuel-from-light-oil",
};

/** Recipes that convert between byproducts, which the flow runs only where they save resources. */
export const balancingRecipes = ["heavy-oil-cracking", "light-oil-cracking"];

/** Wiki icon file names (without extension) where they differ from the item's display name. */
export const iconFiles: Record<string, string> = {
  "stone-wall": "Wall",
  rail: "Straight_rail",
};

/** How players name each belt tier, and its color for belt tiles. */
export const beltStyles: Record<string, { shortName: string; color: string }> = {
  "transport-belt": { shortName: "Yellow", color: "oklch(0.84 0.15 92)" },
  "fast-transport-belt": { shortName: "Red", color: "oklch(0.66 0.18 25)" },
  "express-transport-belt": { shortName: "Blue", color: "oklch(0.72 0.12 235)" },
};

export const wikiIcon = (name: string) => `https://wiki.factorio.com/images/${name}.png`;
