import type { ItemId, ProductionData, RecipeId } from "../data/types.ts";
import { edgeKey, type Flow } from "./computeFlow.ts";

// Rates below this are floating point noise from the arithmetic, not flow.
const epsilon = 1e-9;

export interface Feeds {
  /** Each fed item, with the recipe that makes it and the one recipe that consumes it. */
  fedItems: Map<ItemId, { producer: RecipeId; consumer: RecipeId }>;
  /** Each feeder's consumer: the block member one level up. */
  consumerOf: Map<RecipeId, RecipeId>;
  /** Each consumer's feeders, in the order of the consumer's recipe inputs. */
  feedersOf: Map<RecipeId, RecipeId[]>;
  /** Each block member's level: 0 when nothing feeds it, else one more than its highest feeder. */
  levelOf: Map<RecipeId, number>;
  /** Block roots: members that have feeders and feed nothing, in `flow.itemOrder` order of what they make. */
  roots: RecipeId[];
}

/** No fed items at all, for layouts that keep every item on the bus. */
export const noFeeds: Feeds = {
  fedItems: new Map(),
  consumerOf: new Map(),
  feedersOf: new Map(),
  levelOf: new Map(),
  roots: [],
};

/**
 * Finds the items that go straight from their one producer to their one consumer instead of
 * riding the bus, and groups the recipes involved into blocks. Decided from the flow alone.
 */
export function findFeeds(data: ProductionData, flow: Flow): Feeds {
  const crackers = new Set([...flow.producersOf.values()].flatMap((recipes) => recipes.slice(1)));
  // Index consumers once from the edges, since the layout calls this for every combination the
  // Layout sheet measures.
  const consumersOf = new Map<ItemId, RecipeId[]>();
  for (const recipe of flow.recipeCrafts.keys()) {
    for (const item of Object.keys(data.recipes[recipe].inputs)) {
      if ((flow.edgeRate.get(edgeKey(recipe, item)) ?? 0) <= epsilon) continue;
      consumersOf.set(item, [...(consumersOf.get(item) ?? []), recipe]);
    }
  }

  const hasExport = (recipe: RecipeId) =>
    Object.keys(data.recipes[recipe].outputs).some(
      (output) =>
        ((flow.outputRate.get(output) ?? 0) > 0 && flow.producerOf.get(output) === recipe) ||
        (flow.storedRate.get(edgeKey(recipe, output)) ?? 0) > epsilon,
    );

  // A feeder with an export is left out, since the export would run into the consumer's frame.
  const candidates = new Map<ItemId, { producer: RecipeId; consumer: RecipeId }>();
  for (const item of flow.itemOrder) {
    const producer = flow.producerOf.get(item);
    const consumers = consumersOf.get(item) ?? [];
    if (!producer || data.items[item].raw) continue;
    if (flow.producersOf.get(item)?.length !== 1 || consumers.length !== 1) continue;
    const consumer = consumers[0];
    if (flow.backEdges.has(edgeKey(consumer, item)) || producer === consumer) continue;
    if (crackers.has(producer) || crackers.has(consumer) || hasExport(producer)) continue;
    candidates.set(item, { producer, consumer });
  }

  // A producer is fed only when every item it makes goes to the same consumer.
  const fedItems = new Map<ItemId, { producer: RecipeId; consumer: RecipeId }>();
  for (const [item, { producer, consumer }] of candidates) {
    const madeItems = Object.keys(data.recipes[producer].outputs).filter(
      (output) => (flow.madeRate.get(edgeKey(producer, output)) ?? 0) > epsilon,
    );
    if (madeItems.every((output) => candidates.get(output)?.consumer === consumer)) {
      fedItems.set(item, { producer, consumer });
    }
  }

  const consumerOf = new Map<RecipeId, RecipeId>();
  for (const { producer, consumer } of fedItems.values()) consumerOf.set(producer, consumer);

  const feedersOf = new Map<RecipeId, RecipeId[]>();
  for (const consumer of new Set(consumerOf.values())) {
    const feeders = Object.keys(data.recipes[consumer].inputs).flatMap((item) => {
      const fed = fedItems.get(item);
      return fed?.consumer === consumer ? [fed.producer] : [];
    });
    feedersOf.set(consumer, [...new Set(feeders)]);
  }

  // Back edges are excluded from the fed items, so this recursion cannot loop.
  const levelOf = new Map<RecipeId, number>();
  const level = (recipe: RecipeId): number => {
    const feeders = feedersOf.get(recipe) ?? [];
    const value = feeders.length === 0 ? 0 : Math.max(...feeders.map(level)) + 1;
    levelOf.set(recipe, value);
    return value;
  };
  for (const recipe of [...consumerOf.keys(), ...feedersOf.keys()]) level(recipe);

  const roots: RecipeId[] = [];
  for (const item of flow.itemOrder) {
    const recipe = flow.producerOf.get(item);
    if (recipe && feedersOf.has(recipe) && !consumerOf.has(recipe) && !roots.includes(recipe)) {
      roots.push(recipe);
    }
  }

  return { fedItems, consumerOf, feedersOf, levelOf, roots };
}
