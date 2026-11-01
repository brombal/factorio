// Imports FactorioLab's vanilla 2.0 dataset into src/data/vanilla.json, in this project's own
// data shape. Run with `node scripts/importVanilla.ts [path-or-url] [--check-icons]`.
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { balancingRecipes, iconFiles, wikiIcon } from "../src/data/overrides.ts";
import type {
  BeltTier,
  CraftingCategory,
  ExtractionCategory,
  Item,
  ItemCategory,
  Machine,
  Module,
  Recipe,
} from "../src/data/types.ts";

const defaultSource =
  "https://raw.githubusercontent.com/factoriolab/factoriolab/main/public/data/2.0/data.json";
const outputPath = new URL("../src/data/vanilla.json", import.meta.url);

interface LabItem {
  id: string;
  name: string;
  category: string;
  types?: string[];
  machine?: { speed: number; modules?: number };
  module?: { speed?: number; productivity?: number };
  belt?: { speed: number; itemTypes: string[] };
}
interface LabRecipe {
  id: string;
  name: string;
  category: string;
  time: number;
  producers: string[];
  in: Record<string, number>;
  out: Record<string, number>;
  flags?: string[];
  disallowedEffects?: string[];
}
interface LabData {
  version: { base: string };
  icons: { id: string; color?: string }[];
  items: LabItem[];
  recipes: LabRecipe[];
}

// Read the dataset from a file or URL.
const args = process.argv.slice(2);
const checkIcons = args.includes("--check-icons");
const source = args.find((arg) => !arg.startsWith("--")) ?? defaultSource;
const lab: LabData = JSON.parse(
  source.startsWith("http") ? await (await fetch(source)).text() : await readFile(source, "utf8"),
);

// Name the game's recipe categories by the machines that can run them.
const categoryByProducers: Record<string, CraftingCategory> = {
  "assembling-machine-1,assembling-machine-2,assembling-machine-3": "crafting",
  "assembling-machine-2,assembling-machine-3": "crafting-with-fluid",
  "stone-furnace,steel-furnace,electric-furnace": "smelting",
  "chemical-plant": "chemistry",
  "oil-refinery": "oil-processing",
  centrifuge: "centrifuging",
  "rocket-silo": "rocket-building",
};
// Machines that make power or pump raw fluids rather than craft; their recipes are left out.
const nonCrafting = new Set([
  "boiler",
  "heat-exchanger",
  "nuclear-reactor",
  "offshore-pump",
  "pumpjack",
]);

const labItems = lab.items.filter((item) => item.category !== "technology");
const isFluid = (id: string) => labItems.find((item) => item.id === id)?.types?.includes("fluid");

// Mining recipes become raw items with a mining time, and so does the offshore pump's water
// recipe, which the dataset does not flag as mining.
const miningRecipes = lab.recipes.filter((recipe) => recipe.flags?.includes("mining"));
const extractionRecipes = [
  ...miningRecipes,
  ...lab.recipes.filter((recipe) => recipe.producers.includes("offshore-pump")),
];
const extractionByProducer: Record<string, ExtractionCategory> = {
  "burner-mining-drill": "mining",
  "electric-mining-drill": "mining",
  pumpjack: "fluid-extraction",
  "offshore-pump": "offshore",
};
const craftingRecipes = lab.recipes.filter(
  (recipe) =>
    recipe.category !== "technology" &&
    !recipe.flags?.includes("mining") &&
    !recipe.id.includes("barrel") &&
    !recipe.producers.some((producer) => nonCrafting.has(producer)),
);
const produced = new Set(craftingRecipes.flatMap((recipe) => Object.keys(recipe.out)));
const used = new Set(craftingRecipes.flatMap((recipe) => Object.keys(recipe.in)));
// Raw items are what no recipe makes; ones no recipe uses either (raw fish) are left out.
const raw = new Set(
  labItems
    .filter((item) => !produced.has(item.id) && used.has(item.id) && !item.id.includes("barrel"))
    .map((item) => item.id),
);
// Raw items that come out of something the chart does not model yet, and why.
const blockedRaw = new Map<string, string>([
  ["steam", "Needs power"],
  ["steam-500", "Needs power"],
  ["depleted-uranium-fuel-cell", "Comes from a nuclear reactor"],
]);
// Uranium ore is mined with sulfuric acid, and drills do not take inputs on the chart yet.
for (const recipe of miningRecipes) {
  if (!Object.keys(recipe.in).some((input) => isFluid(input))) continue;
  for (const id of Object.keys(recipe.out)) blockedRaw.set(id, "Needs mining with fluid");
}

// Work forward from the raw items the chart can extract: a recipe whose inputs are all available
// makes its outputs available. Going forward rather than back means a loop such as kovarex cannot
// make its own items available.
const availableIds = new Set([...raw].filter((id) => !blockedRaw.has(id)));
const recipeAvailable = (recipe: LabRecipe) =>
  Object.keys(recipe.in).every((id) => availableIds.has(id));
for (let grew = true; grew; ) {
  grew = false;
  for (const recipe of craftingRecipes.filter(recipeAvailable)) {
    for (const id of Object.keys(recipe.out)) {
      if (!availableIds.has(id)) grew = Boolean(availableIds.add(id));
    }
  }
}

// An unavailable item takes the reason of the blocked raw item behind its first recipe.
const unavailableReasonOf = (id: string, visiting = new Set<string>()): string | undefined => {
  if (availableIds.has(id) || visiting.has(id)) return undefined;
  if (blockedRaw.has(id)) return blockedRaw.get(id);
  visiting.add(id);
  const recipe = craftingRecipes.find((candidate) => candidate.out[id]);
  // An input nothing imported makes, such as the barrel in cliff explosives.
  if (!recipe && !raw.has(id)) return `Needs ${labItems.find((item) => item.id === id)?.name}`;
  return Object.keys(recipe?.in ?? {})
    .map((input) => unavailableReasonOf(input, visiting))
    .find(Boolean);
};

const categoryOf = (item: LabItem): ItemCategory => {
  if (item.types?.includes("fluid")) return "fluid";
  if (raw.has(item.id)) return "raw";
  if (item.id.endsWith("-science-pack")) return "science";
  if (item.category === "combat") return "military";
  if (item.category === "intermediate-products") return "intermediate";
  if (item.category === "logistics" || item.category === "production") return item.category;
  throw new Error(`No category mapping for ${item.id} (${item.category})`);
};

// Turn the icon's average color into a line color in the chart's range: bright, muted, and
// readable on the dark background, keeping the hue.
const toChartColor = (hex: string) => {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [channel(1), channel(3), channel(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363319 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.min(Math.hypot(a, bb), 0.13);
  const hue = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  const clampedLightness = Math.min(0.82, Math.max(0.66, lightness));
  return `oklch(${clampedLightness.toFixed(2)} ${chroma.toFixed(2)} ${Math.round(hue)})`;
};
const iconColor = new Map(lab.icons.map((icon) => [icon.id, icon.color]));

// Items: everything outside technologies and barrels that is made or used by some recipe.
const items: Omit<Item, "icon">[] = labItems
  .filter((item) => !item.id.includes("barrel") && (produced.has(item.id) || raw.has(item.id)))
  .map((item) => {
    const extraction = extractionRecipes.find((recipe) => recipe.out[item.id]);
    const extractedBy = extraction && extractionByProducer[extraction.producers[0]];
    const color = iconColor.get(item.id);
    const reason = availableIds.has(item.id)
      ? undefined
      : (unavailableReasonOf(item.id) ?? "Cannot be made yet");
    return {
      id: item.id,
      name: item.name,
      category: categoryOf(item),
      source: "base",
      ...(raw.has(item.id) ? { raw: true } : {}),
      ...(color ? { color: toChartColor(color) } : {}),
      ...(extraction ? { miningTime: extraction.time / extraction.out[item.id] } : {}),
      ...(extractedBy && extractedBy !== "mining" ? { extraction: extractedBy } : {}),
      ...(reason ? { unavailableReason: reason } : {}),
    };
  });
const itemCategory = new Map(items.map((item) => [item.id, item.category]));

const recipes: Recipe[] = craftingRecipes.map((recipe) => {
  const craftingCategory = categoryByProducers[recipe.producers.join(",")];
  if (!craftingCategory) throw new Error(`No crafting category for ${recipe.id}`);
  const outputs = Object.keys(recipe.out);
  // The flow adds a cracker's demand after everything else, which only stays correct when every
  // input but the oil it cracks is raw.
  const notRaw = Object.keys(recipe.in).filter((input) => !raw.has(input));
  if (balancingRecipes.includes(recipe.id) && notRaw.length !== 1) {
    throw new Error(`Balancing recipe ${recipe.id} needs exactly one input that is not raw`);
  }
  return {
    id: recipe.id,
    // Only recipes not named after their output need a name of their own.
    ...(outputs.includes(recipe.id) ? {} : { name: recipe.name }),
    category: itemCategory.get(outputs[0]) ?? "intermediate",
    source: "base",
    craftingCategory,
    time: recipe.time,
    inputs: recipe.in,
    outputs: recipe.out,
    allowProductivity: !recipe.disallowedEffects?.includes("productivity"),
    ...(balancingRecipes.includes(recipe.id) ? { balancing: true } : {}),
  };
});

// Machines get the categories of the recipes the chart can make with them, so groups that
// only serve unavailable recipes (the centrifuge) stay out of the Build sheet.
const availableCategories = new Map<string, Set<string>>();
const addCategory = (producer: string, category: string) =>
  availableCategories.set(producer, (availableCategories.get(producer) ?? new Set()).add(category));
for (const recipe of craftingRecipes) {
  if (!recipeAvailable(recipe)) continue;
  const category = categoryByProducers[recipe.producers.join(",")];
  for (const producer of recipe.producers) addCategory(producer, category);
}
// Drills, pumpjacks, and offshore pumps join their extraction group.
for (const recipe of extractionRecipes) {
  if (Object.keys(recipe.out).some((id) => blockedRaw.has(id))) continue;
  for (const producer of recipe.producers) addCategory(producer, extractionByProducer[producer]);
}
const machines: Omit<Machine, "icon">[] = labItems
  .filter((item) => item.machine && availableCategories.has(item.id))
  .map((item) => ({
    id: item.id,
    name: item.name,
    source: "base",
    speed: item.machine?.speed ?? 1,
    categories: [...(availableCategories.get(item.id) ?? [])] as Machine["categories"],
    moduleSlots: item.machine?.modules ?? 0,
  }));

const belts: Omit<BeltTier, "icon" | "shortName" | "color">[] = labItems
  .filter((item) => item.belt?.itemTypes.includes("item"))
  .map((item) => ({
    id: item.id,
    name: item.name,
    source: "base",
    perSecond: item.belt?.speed ?? 0,
  }));

// Efficiency modules are left out: they only change power, which the chart does not show.
const modules: Omit<Module, "icon">[] = labItems
  .filter((item) => item.module && (item.module.speed ?? 0) !== 0)
  .map((item) => ({
    id: item.id,
    name: item.name,
    source: "base",
    kind: item.module?.productivity ? "productivity" : "speed",
    tier: Number(item.id.match(/-(\d)$/)?.[1] ?? 1),
    speed: item.module?.speed ?? 0,
    productivity: item.module?.productivity ?? 0,
  }));

writeFileSync(
  outputPath,
  `${JSON.stringify({ version: lab.version.base, items, recipes, machines, belts, modules }, null, 2)}\n`,
);
const available = items.filter((item) => !item.unavailableReason);
console.log(
  `Wrote ${items.length} items (${available.length} available), ${recipes.length} recipes, ${machines.length} machines, ${belts.length} belts, ${modules.length} modules from game version ${lab.version.base}.`,
);
console.log(`Raw: ${[...raw].join(", ")}`);

// Check that every available item's wiki icon loads, so missing ones can be added to iconFiles.
if (checkIcons) {
  const named = [...available, ...machines, ...modules, ...belts];
  const results = await Promise.all(
    named.map(async (entry) => {
      const url = wikiIcon(iconFiles[entry.id] ?? entry.name.replace(/ /g, "_"));
      const response = await fetch(url, { method: "HEAD" });
      return { id: entry.id, url, ok: response.ok };
    }),
  );
  const missing = results.filter((result) => !result.ok);
  console.log(
    missing.length
      ? `Missing icons:\n${missing.map((result) => `  ${result.id}: ${result.url}`).join("\n")}`
      : `All ${results.length} icons load.`,
  );
}
