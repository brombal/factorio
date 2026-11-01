import type { Item, ItemCategory, ItemId, Output, ProductionData } from "../data/types.ts";

/** The groups the Outputs sheet shows, in order. */
export const outputCategories: ItemCategory[] = [
  "science",
  "intermediate",
  "logistics",
  "production",
  "military",
  "raw",
];

/**
 * Every item that can be an output, mined or made by some recipe, grouped by category in data
 * order. Items the chart cannot make yet come last in their group.
 */
export function outputCandidates(data: ProductionData): Map<ItemCategory, Item[]> {
  const produced = new Set(
    Object.values(data.recipes).flatMap((recipe) => Object.keys(recipe.outputs)),
  );
  const groups = new Map<ItemCategory, Item[]>(outputCategories.map((category) => [category, []]));
  for (const item of Object.values(data.items)) {
    if (!item.raw && !produced.has(item.id)) continue;
    groups.get(item.category)?.push(item);
  }
  for (const [category, list] of groups) {
    groups.set(category, [
      ...list.filter((item) => !item.unavailableReason),
      ...list.filter((item) => item.unavailableReason),
    ]);
  }
  return groups;
}

/**
 * The rate an item starts at when it is turned on. Science and intermediates are made by the
 * belt; buildings and gear are made a few at a time, and 1/s of them would be a huge mall.
 */
export function defaultOutputRate(item: Item): number {
  return item.category === "science" || item.category === "intermediate" ? 1 : 0.1;
}

/**
 * Sorts outputs into data order, so the flow walk, and with it the layout's tie-breaks, does
 * not depend on the order the player turned items on.
 */
export function orderOutputs(data: ProductionData, outputs: Output[]): Output[] {
  const position = new Map(Object.keys(data.items).map((item, index) => [item, index]));
  return [...outputs].sort(
    (a, b) => (position.get(a.item) ?? Infinity) - (position.get(b.item) ?? Infinity),
  );
}

/** Seeds the first visit: three science packs plus a small mall of buildings and turret ammo. */
const initialOutputs: Output[] = [
  { item: "automation-science-pack", perSecond: 1 },
  { item: "logistic-science-pack", perSecond: 1 },
  { item: "military-science-pack", perSecond: 1 },
  { item: "firearm-magazine", perSecond: 0.5 },
  { item: "electric-mining-drill", perSecond: 0.2 },
  { item: "assembling-machine-1", perSecond: 0.1 },
  { item: "steel-furnace", perSecond: 0.1 },
  { item: "lab", perSecond: 0.05 },
  { item: "splitter", perSecond: 0.1 },
  { item: "underground-belt", perSecond: 0.2 },
  { item: "fast-transport-belt", perSecond: 0.5 },
  { item: "fast-inserter", perSecond: 0.1 },
  { item: "long-handed-inserter", perSecond: 0.1 },
  { item: "medium-electric-pole", perSecond: 0.2 },
  { item: "rail", perSecond: 1 },
  { item: "gun-turret", perSecond: 0.1 },
];

/**
 * The player's outputs, plus the last rate each item had when it was on, so turning an item
 * back on restores that rate instead of the default.
 */
export interface OutputState {
  outputs: Output[];
  lastRates: Record<ItemId, number>;
}

/**
 * Sets an item's output rate. Zero or less turns it off, the same as toggling it off in the
 * Outputs sheet, and remembers the rate it had.
 */
export function setOutputRate(
  data: ProductionData,
  state: OutputState,
  item: ItemId,
  perSecond: number,
): OutputState {
  const current = state.outputs.find((output) => output.item === item);
  const others = state.outputs.filter((output) => output.item !== item);
  if (perSecond <= 0) {
    return {
      outputs: others,
      lastRates: current ? { ...state.lastRates, [item]: current.perSecond } : state.lastRates,
    };
  }
  return {
    outputs: orderOutputs(data, [...others, { item, perSecond }]),
    lastRates: { ...state.lastRates, [item]: perSecond },
  };
}

/** Turns an item off, or back on at its last rate (or the default for its category). */
export function toggleOutput(data: ProductionData, state: OutputState, item: Item): OutputState {
  const on = state.outputs.some((output) => output.item === item.id);
  const rate = on ? 0 : (state.lastRates[item.id] ?? defaultOutputRate(item));
  return setOutputRate(data, state, item.id, rate);
}

const storageKey = "factorio-bus:outputs";
// Before the rename to outputs, the list was saved as a plain array under this key.
const oldStorageKey = "factorio-bus:targets";

const readJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    // Storage can be unavailable or hold garbage; the seed list is fine either way.
    return null;
  }
};

/**
 * Reads the saved outputs, dropping unknown or unavailable items and bad rates. A saved empty
 * list stays empty; nothing saved at all gets the seed list.
 */
export function loadOutputs(data: ProductionData): OutputState {
  const saved = readJson(storageKey) as Partial<OutputState> | null;
  const list = saved?.outputs ?? readJson(oldStorageKey);
  if (!Array.isArray(list)) return { outputs: orderOutputs(data, initialOutputs), lastRates: {} };
  const usable = (item: unknown, rate: unknown): rate is number =>
    typeof item === "string" &&
    data.items[item] !== undefined &&
    !data.items[item].unavailableReason &&
    typeof rate === "number" &&
    rate > 0;
  const seen = new Set<ItemId>();
  const outputs = list.filter((output): output is Output => {
    const valid = usable(output?.item, output?.perSecond) && !seen.has(output.item);
    if (valid) seen.add(output.item);
    return valid;
  });
  const lastRates = Object.fromEntries(
    Object.entries(saved?.lastRates ?? {}).filter(([item, rate]) => usable(item, rate)),
  );
  return { outputs: orderOutputs(data, outputs), lastRates };
}

export function saveOutputs(state: OutputState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Not persisting is acceptable; the outputs still apply for this visit.
  }
}
