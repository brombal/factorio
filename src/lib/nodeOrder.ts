import type { ItemId, ProductionData } from "../data/types.ts";
import { edgeKey, type Flow } from "./computeFlow.ts";

/**
 * How items are ordered along the bus. Every rule keeps each item after its inputs.
 *
 * - "depth": by crafting steps from raw resources, so ores come first, then plates, then
 *   what is made from plates, and so on.
 * - "outputs": the flow engine's walk from the outputs in list order, which keeps each
 *   output's chain together.
 * - "lastInput": raw resources first, then each item as soon after its last input as it can
 *   go, which keeps chains of single steps next to each other.
 */
export type NodeOrder = "depth" | "outputs" | "lastInput";

export function orderItems(data: ProductionData, flow: Flow, rule: NodeOrder): ItemId[] {
  const walk = flow.itemOrder;
  if (rule === "outputs") return walk;

  const inUse = new Set(walk);
  const position = new Map(walk.map((item, index) => [item, index]));
  // Inputs that close a loop are left out, so the ordering cannot wait on itself.
  const inputsOf = (item: ItemId) => {
    const recipe = flow.producerOf.get(item);
    if (!recipe) return [];
    return Object.keys(data.recipes[recipe].inputs).filter(
      (input) => inUse.has(input) && !flow.backEdges.has(edgeKey(recipe, input)),
    );
  };

  if (rule === "depth") {
    const depth = new Map<ItemId, number>();
    for (const item of walk) {
      depth.set(item, Math.max(-1, ...inputsOf(item).map((input) => depth.get(input) ?? 0)) + 1);
    }
    return [...walk].sort(
      (a, b) =>
        (depth.get(a) ?? 0) - (depth.get(b) ?? 0) ||
        (position.get(a) ?? 0) - (position.get(b) ?? 0),
    );
  }

  // "lastInput": repeatedly place the ready item whose newest input was placed most recently.
  const order = walk.filter((item) => !flow.producerOf.get(item));
  const placed = new Map(order.map((item, index) => [item, index]));
  while (order.length < walk.length) {
    let best: ItemId | undefined;
    let bestNewest = -1;
    for (const item of walk) {
      if (placed.has(item)) continue;
      const inputs = inputsOf(item);
      if (!inputs.every((input) => placed.has(input))) continue;
      const newest = Math.max(-1, ...inputs.map((input) => placed.get(input) ?? -1));
      // Ties keep the walk's order, which is the order `walk` is scanned in.
      if (best === undefined || newest > bestNewest) {
        best = item;
        bestNewest = newest;
      }
    }
    // Nothing ready only happens with a cycle the back edges missed; fall back to the walk.
    if (best === undefined) best = walk.find((item) => !placed.has(item)) ?? walk[0];
    placed.set(best, order.length);
    order.push(best);
  }
  return order;
}
