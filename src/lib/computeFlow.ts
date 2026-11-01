import type { ItemId, Output, ProductionData, RecipeId } from "../data/types.ts";

export interface FlowOptions {
  /** Recipes removed from the chart. Demand that would flow through them is dropped. */
  hiddenRecipes?: ReadonlySet<RecipeId>;
  /**
   * Which recipe produces an item when several can. Defaults to the data's preferred recipe,
   * then the first one declared.
   */
  preferredRecipe?: Readonly<Record<ItemId, RecipeId>>;
  /** Extra output per craft as a fraction, per recipe, from productivity modules. */
  productivity?: ReadonlyMap<RecipeId, number>;
}

export interface Flow {
  /** Items in production order: every item appears after all of its producer's inputs. */
  itemOrder: ItemId[];
  /** The recipe chosen to produce each crafted item that is in use. */
  producerOf: Map<ItemId, RecipeId>;
  /** Total units per second required of each item, across all consumers and player outputs. */
  itemRate: Map<ItemId, number>;
  /** The part of each item's rate that is a player output rather than consumed by a recipe. */
  outputRate: Map<ItemId, number>;
  /** Crafts per second of each recipe in use. */
  recipeCrafts: Map<RecipeId, number>;
  /** Units per second flowing along each recipe input, keyed by edgeKey(recipe, item). */
  edgeRate: Map<string, number>;
  /** Recipe inputs that close a cycle (an item that feeds its own production chain). */
  backEdges: Set<string>;
  /** The productivity bonus each recipe ran with; absent means none. */
  productivity: ReadonlyMap<RecipeId, number>;
}

export const edgeKey = (recipe: RecipeId, item: ItemId) => `${recipe}\u0000${item}`;

/**
 * Works out how much of everything a factory needs to produce the given outputs, by walking
 * the recipe tree backward from each output and summing demand on every item and every recipe
 * input. The result drives both which items appear on the bus and how wide each line is drawn.
 */
export function computeFlow(
  data: ProductionData,
  outputs: Output[],
  options: FlowOptions = {},
): Flow {
  const hidden = options.hiddenRecipes ?? new Set<RecipeId>();
  const preferred = { ...data.preferredRecipes, ...options.preferredRecipe };
  const productivity = options.productivity ?? new Map<RecipeId, number>();

  const producerOf = new Map<ItemId, RecipeId>();
  const findProducer = (item: ItemId) => {
    if (producerOf.has(item)) return producerOf.get(item);
    if (data.items[item]?.raw) return undefined;
    const wanted = preferred[item];
    const candidates = Object.values(data.recipes).filter(
      (recipe) => (recipe.outputs[item] ?? 0) > 0 && !hidden.has(recipe.id),
    );
    const recipe = candidates.find((candidate) => candidate.id === wanted) ?? candidates[0];
    if (recipe) producerOf.set(item, recipe.id);
    return recipe?.id;
  };

  // Depth-first post-order from the outputs gives producers-first ordering. An input that is
  // already on the visiting stack closes a cycle; it is recorded and skipped so the order stays
  // well defined.
  const itemOrder: ItemId[] = [];
  const visited = new Set<ItemId>();
  const onStack = new Set<ItemId>();
  const backEdges = new Set<string>();
  const visit = (item: ItemId) => {
    if (visited.has(item)) return;
    visited.add(item);
    onStack.add(item);
    const recipeId = findProducer(item);
    if (recipeId) {
      for (const input of Object.keys(data.recipes[recipeId].inputs)) {
        if (onStack.has(input)) backEdges.add(edgeKey(recipeId, input));
        else visit(input);
      }
    }
    onStack.delete(item);
    itemOrder.push(item);
  };
  for (const output of outputs) {
    if (data.items[output.item] && !hidden.has(output.item)) visit(output.item);
  }

  // Propagate demand from consumers to producers. Walking the reverse of the post-order means
  // every consumer of an item has been processed before the item itself, so its demand is final
  // when its recipe's craft rate is set.
  const itemRate = new Map<ItemId, number>();
  const recipeCrafts = new Map<RecipeId, number>();
  const edgeRate = new Map<string, number>();
  const outputRate = new Map<ItemId, number>();
  for (const output of outputs) {
    if (!visited.has(output.item)) continue;
    itemRate.set(output.item, (itemRate.get(output.item) ?? 0) + output.perSecond);
    outputRate.set(output.item, (outputRate.get(output.item) ?? 0) + output.perSecond);
  }
  for (const item of [...itemOrder].reverse()) {
    const recipeId = producerOf.get(item);
    if (!recipeId) continue;
    const recipe = data.recipes[recipeId];
    // A recipe with several outputs runs fast enough to satisfy the most demanding one, so only
    // the increase over the rate already set by an earlier output is pushed to the inputs.
    const previous = recipeCrafts.get(recipeId) ?? 0;
    // Productivity adds output to every craft, so fewer crafts, and fewer inputs, are needed.
    const perCraft = recipe.outputs[item] * (1 + (productivity.get(recipeId) ?? 0));
    const crafts = Math.max(previous, (itemRate.get(item) ?? 0) / perCraft);
    const delta = crafts - previous;
    if (delta <= 0) continue;
    recipeCrafts.set(recipeId, crafts);
    for (const [input, count] of Object.entries(recipe.inputs)) {
      const key = edgeKey(recipeId, input);
      edgeRate.set(key, (edgeRate.get(key) ?? 0) + delta * count);
      itemRate.set(input, (itemRate.get(input) ?? 0) + delta * count);
    }
  }

  return {
    itemOrder,
    producerOf,
    itemRate,
    outputRate,
    recipeCrafts,
    edgeRate,
    backEdges,
    productivity,
  };
}
