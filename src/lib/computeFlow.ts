import type { ItemId, Output, ProductionData, Recipe, RecipeId } from "../data/types.ts";

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
  /** Total units per second of each item: what consumers and player outputs need, plus surplus. */
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
  /** Every recipe that makes each item in use: the primary producer first, then any crackers. */
  producersOf: Map<ItemId, RecipeId[]>;
  /** Units per second each recipe makes of each of its outputs, keyed by edgeKey(recipe, item). */
  madeRate: Map<string, number>;
  /** Output that nothing consumes and no player output asked for, which the player stores. */
  surplusRate: Map<ItemId, number>;
  /**
   * Where each item's surplus is stored, keyed by edgeKey(recipe, item): at the producers that
   * made it, the latest cracker first, so a cracker that only feeds storage shows as one.
   */
  storedRate: Map<string, number>;
}

/** A balancing recipe that turns one output of a recipe into another output of the same recipe. */
interface Link {
  recipe: Recipe;
  from: ItemId;
  to: ItemId;
  /** Units of `to` made from each unit of `from`, after the cracker's productivity. */
  ratio: number;
}

// Rates below this are floating point noise from the arithmetic, not flow.
const epsilon = 1e-9;

export const edgeKey = (recipe: RecipeId, item: ItemId) => `${recipe}\u0000${item}`;

/**
 * Works out how much of everything a factory needs to produce the given outputs, by walking
 * the recipe tree backward from each output and summing demand on every item and every recipe
 * input. The result drives both which items appear on the bus and how wide each line is drawn.
 *
 * Balancing recipes (oil cracking) always crack what their recipe leaves over: heavy oil that
 * nothing uses becomes light oil, and light oil becomes petroleum gas. A recipe with crackers on
 * its outputs runs fast enough for whichever output is its bottleneck once cracking is counted,
 * and anything still left over is reported as surplus to store.
 */
export function computeFlow(
  data: ProductionData,
  outputs: Output[],
  options: FlowOptions = {},
): Flow {
  const hidden = options.hiddenRecipes ?? new Set<RecipeId>();
  const preferred = { ...data.preferredRecipes, ...options.preferredRecipe };
  const productivity = options.productivity ?? new Map<RecipeId, number>();

  const usable = (recipe: Recipe) =>
    !hidden.has(recipe.id) &&
    Object.keys(recipe.inputs).every((input) => !data.items[input]?.unavailableReason);
  const crackers = Object.values(data.recipes).filter(
    (recipe) => recipe.balancing && usable(recipe),
  );
  const perCraft = (recipe: Recipe, item: ItemId) =>
    (recipe.outputs[item] ?? 0) * (1 + (productivity.get(recipe.id) ?? 0));

  // A cracker is never an item's primary producer; it only adds to what another recipe makes.
  const producerOf = new Map<ItemId, RecipeId>();
  const findProducer = (item: ItemId) => {
    if (producerOf.has(item)) return producerOf.get(item);
    if (data.items[item]?.raw) return undefined;
    const wanted = preferred[item];
    const candidates = Object.values(data.recipes).filter(
      (recipe) => (recipe.outputs[item] ?? 0) > 0 && !recipe.balancing && usable(recipe),
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
    if (!recipeId) return;
    // A recipe's other outputs and its crackers' inputs are in use whenever it runs, even when
    // nothing asked for them, so they get a place in the order too.
    const recipe = data.recipes[recipeId];
    for (const output of Object.keys(recipe.outputs)) visit(output);
    for (const cracker of crackers) {
      if (!Object.keys(cracker.inputs).some((input) => input in recipe.outputs)) continue;
      for (const input of Object.keys(cracker.inputs)) visit(input);
    }
  };
  // Walk the outputs that no other output uses first, so turning on an output that is already
  // made inside another output's tree leaves the walk, and every node order, unchanged.
  const usedInside = new Set<ItemId>();
  const collectInputs = (item: ItemId) => {
    const recipeId = findProducer(item);
    if (!recipeId) return;
    for (const input of Object.keys(data.recipes[recipeId].inputs)) {
      if (usedInside.has(input)) continue;
      usedInside.add(input);
      collectInputs(input);
    }
  };
  const walked = outputs.filter((output) => data.items[output.item] && !hidden.has(output.item));
  for (const output of walked) collectInputs(output.item);
  for (const output of walked) if (!usedInside.has(output.item)) visit(output.item);
  for (const output of walked) visit(output.item);

  // Find each recipe's crackers: a cracker links two outputs that the recipe is the primary
  // producer of, so it never cracks into an item some other recipe is making.
  const linksOf = new Map<RecipeId, Map<ItemId, Link>>();
  for (const recipeId of new Set(producerOf.values())) {
    const owned = (item: ItemId) => producerOf.get(item) === recipeId;
    const links = new Map<ItemId, Link>();
    for (const cracker of crackers) {
      const from = Object.keys(cracker.inputs).find(owned);
      const to = Object.keys(cracker.outputs).find(owned);
      if (!from || !to || links.has(from)) continue;
      links.set(from, {
        recipe: cracker,
        from,
        to,
        ratio: perCraft(cracker, to) / cracker.inputs[from],
      });
    }
    linksOf.set(recipeId, links);
  }
  // The outputs a recipe makes as primary producer, as chains that start with an output no
  // cracker makes and follow its crackers: heavy oil, then light oil, then petroleum gas.
  const chainsOf = (recipe: Recipe) => {
    const links = linksOf.get(recipe.id) ?? new Map<ItemId, Link>();
    const cracked = new Set([...links.values()].map((link) => link.to));
    return Object.keys(recipe.outputs)
      .filter((item) => producerOf.get(item) === recipe.id && !cracked.has(item))
      .map((start) => {
        const chain = [start];
        for (let link = links.get(start); link && !chain.includes(link.to); ) {
          chain.push(link.to);
          link = links.get(link.to);
        }
        return chain;
      });
  };

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
    // the increase over the rate already set by an earlier output is pushed to the inputs. Along
    // a chain of crackers, what an earlier output leaves over counts toward the later ones, so
    // each output's demand and yield are carried down the chain in units of the next.
    // Productivity adds output to every craft, so fewer crafts, and fewer inputs, are needed.
    const previous = recipeCrafts.get(recipeId) ?? 0;
    let crafts = previous;
    for (const chain of chainsOf(recipe)) {
      let demand = 0;
      let yieldPerCraft = 0;
      chain.forEach((output, index) => {
        if (index > 0) {
          const ratio = linksOf.get(recipeId)?.get(chain[index - 1])?.ratio ?? 0;
          demand *= ratio;
          yieldPerCraft *= ratio;
        }
        demand += itemRate.get(output) ?? 0;
        yieldPerCraft += perCraft(recipe, output);
        if (yieldPerCraft > 0) crafts = Math.max(crafts, demand / yieldPerCraft);
      });
    }
    const delta = crafts - previous;
    if (delta <= 0) continue;
    recipeCrafts.set(recipeId, crafts);
    for (const [input, count] of Object.entries(recipe.inputs)) {
      const key = edgeKey(recipeId, input);
      edgeRate.set(key, (edgeRate.get(key) ?? 0) + delta * count);
      itemRate.set(input, (itemRate.get(input) ?? 0) + delta * count);
    }
  }

  // Crack whatever each recipe leaves over, down each chain. A cracker's other inputs (water)
  // are raw, so adding their demand after the pass cannot leave anything upstream short.
  const addInputs = (recipe: Recipe, crafts: number) => {
    for (const [input, count] of Object.entries(recipe.inputs)) {
      const key = edgeKey(recipe.id, input);
      edgeRate.set(key, (edgeRate.get(key) ?? 0) + crafts * count);
      itemRate.set(input, (itemRate.get(input) ?? 0) + crafts * count);
    }
  };
  for (const [recipeId, crafts] of [...recipeCrafts]) {
    const recipe = data.recipes[recipeId];
    for (const chain of chainsOf(recipe)) {
      let crackedIn = 0;
      for (const item of chain) {
        const link = linksOf.get(recipeId)?.get(item);
        if (!link) break;
        const produced = perCraft(recipe, item) * crafts + crackedIn;
        const leftover = produced - (itemRate.get(item) ?? 0);
        const crackerCrafts =
          leftover > epsilon * Math.max(1, produced) ? leftover / link.recipe.inputs[item] : 0;
        crackedIn = crackerCrafts * perCraft(link.recipe, link.to);
        if (crackerCrafts === 0) continue;
        recipeCrafts.set(link.recipe.id, (recipeCrafts.get(link.recipe.id) ?? 0) + crackerCrafts);
        addInputs(link.recipe, crackerCrafts);
      }
    }
  }

  // Compare what each item's producers make with what is needed; the difference is surplus.
  const madeRate = new Map<string, number>();
  const made = new Map<ItemId, number>();
  const producersOf = new Map<ItemId, RecipeId[]>();
  for (const [recipeId, crafts] of recipeCrafts) {
    const recipe = data.recipes[recipeId];
    for (const output of Object.keys(recipe.outputs)) {
      const rate = crafts * perCraft(recipe, output);
      madeRate.set(edgeKey(recipeId, output), rate);
      made.set(output, (made.get(output) ?? 0) + rate);
      const producers = producersOf.get(output) ?? [];
      if (producerOf.get(output) === recipeId) producers.unshift(recipeId);
      else producers.push(recipeId);
      producersOf.set(output, producers);
    }
  }
  const surplusRate = new Map<ItemId, number>();
  for (const [item, rate] of made) {
    const needed = itemRate.get(item) ?? 0;
    if (rate - needed > epsilon * Math.max(1, rate)) {
      surplusRate.set(item, rate - needed);
      itemRate.set(item, rate);
    }
  }
  const storedRate = new Map<string, number>();
  for (const [item, surplus] of surplusRate) {
    let left = surplus;
    for (const recipeId of [...(producersOf.get(item) ?? [])].reverse()) {
      const key = edgeKey(recipeId, item);
      const stored = Math.min(left, madeRate.get(key) ?? 0);
      if (stored > 0) storedRate.set(key, stored);
      left -= stored;
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
    producersOf,
    madeRate,
    surplusRate,
    storedRate,
  };
}
