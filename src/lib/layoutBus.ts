import type { ItemId, ProductionData, RecipeId } from "../data/types.ts";
import { roundUp } from "../util/roundUp.ts";
import { edgeKey, type Flow } from "./computeFlow.ts";
import { findFeeds, noFeeds } from "./feeds.ts";
import { isFluid, pipePerSecond } from "./fluids.ts";
import { type NodeOrder, orderItems } from "./nodeOrder.ts";

// The layout works in two abstract axes: "along" runs the length of the bus and "across" is
// perpendicular to it, with negative values on the side where recipe nodes sit. The renderer
// decides whether along is horizontal or vertical.

export interface LayoutOptions {
  iconSize: number;
  /** Padding between the icon and its frame. */
  framePad: number;
  /** Empty space between neighboring node slots along the bus. */
  slotGap: number;
  /** Space between neighboring taps under one node. */
  tapGap: number;
  /** Space between a node's last input and its first output, so the two groups read apart. */
  ioGap: number;
  /** Space between a lane's widest point and the next lane. */
  laneGap: number;
  /** Distance from the first lane's near edge to the center of the recipe nodes. */
  nodeOffset: number;
  /** Line width added by each belt the flow needs, up to `linearBelts`. */
  widthPerBelt: number;
  /** Line width added by each pipe a fluid needs, wider than a belt so a pipe can be drawn hollow. */
  widthPerPipe: number;
  /** Belt or pipe count past which each one adds less width, so rare very wide lanes stay readable. */
  linearBelts: number;
  /** Widest a line is ever drawn. */
  maxWidth: number;
  /** Radius of the inner edge of every curve; the centerline radius grows with the line's width. */
  cornerRadius: number;
  /** How far a lane runs past its last consumer when flow is left over, which only happens around loops. */
  stubLength: number;
  /** How far an export, the line for a player output or stored surplus, extends away from the bus. */
  exportLength: number;
  /** How items are ordered along the bus; see `orderItems`. */
  nodeOrder: NodeOrder;
  /** When an item may take over a lane whose previous occupant has ended; see the lane step. */
  laneReuse: LaneReuse;
  /**
   * Whether nodes that only make player outputs move to raised rows, and items made for a single
   * consumer are fed straight into it as a block; see the placement step.
   */
  outputNodes: OutputNodes;
}

export type LaneReuse = "noCrossing" | "greedy";
export type OutputNodes = "raised" | "inRow";

export const defaultLayoutOptions: LayoutOptions = {
  iconSize: 32,
  framePad: 5,
  slotGap: 20,
  tapGap: 3,
  ioGap: 10,
  laneGap: 8,
  nodeOffset: 64,
  widthPerBelt: 3,
  widthPerPipe: 6,
  linearBelts: 6,
  maxWidth: 28,
  cornerRadius: 6,
  stubLength: 24,
  exportLength: 28,
  nodeOrder: "depth",
  laneReuse: "greedy",
  outputNodes: "raised",
};

export type Pt = [along: number, across: number];

export type PathCommand =
  | { type: "M" | "L"; point: Pt }
  | { type: "C"; control1: Pt; control2: Pt; point: Pt };

export interface LayoutPath {
  id: string;
  item: ItemId;
  /**
   * "lane" is a stretch of bus, which may begin with the drop out of the producer and may end
   * with the turn into the last consumer. "tap" branches off a lane into a consumer, or, when it
   * has a `fromNode`, is a feed straight from its producer. "export" is a player output, or
   * surplus to store, leaving its node away from the bus.
   */
  kind: "lane" | "tap" | "export";
  /** An export of surplus the player stores rather than an output they asked for. */
  stored?: boolean;
  /** Node id this path leaves from, when it includes the drop or export out of a node. */
  fromNode?: string;
  /** Node id this path enters, when it ends in a turn into a consumer. */
  toNode?: string;
  /**
   * Position in the item's flow along the bus. Lane segment n and the tap that leaves at its
   * end share n, so everything at n or above is downstream of segment n. Paths outside the
   * forward flow (exports and loop taps) use -1.
   */
  order: number;
  width: number;
  rate: number;
  backEdge: boolean;
  commands: PathCommand[];
}

export interface LayoutNode {
  id: string;
  kind: "raw" | "recipe";
  item?: ItemId;
  recipe?: RecipeId;
  along: number;
  across: number;
  /** Frame extent along the bus: the square icon frame, stretched when its lines need more room. */
  length: number;
}

/** Where an item's belt label sits: on its drop line, just below the producing node. */
export interface LaneHead {
  item: ItemId;
  /** The drop path the label belongs to, so the label dims with it. */
  pathId: string;
  along: number;
  across: number;
  rate: number;
}

export interface BusLayout {
  nodes: LayoutNode[];
  paths: LayoutPath[];
  laneHeads: LaneHead[];
  bounds: { alongMin: number; alongMax: number; acrossMin: number; acrossMax: number };
  /**
   * How wide the bus is to build: its lanes, and its belts of the chosen tier and its pumped
   * pipes, where each lane counts as many belts or pipes as its busiest item needs at full rate.
   */
  busWidth: { lanes: number; belts: number; pipes: number };
}

// Cubic approximation of a quarter circle: control points sit this fraction of the way to the
// corner, which is accurate to about 0.03% of the radius.
const kappa = 0.5523;

const corner = (from: Pt, at: Pt, to: Pt): PathCommand => ({
  type: "C",
  control1: [from[0] + (at[0] - from[0]) * kappa, from[1] + (at[1] - from[1]) * kappa],
  control2: [to[0] + (at[0] - to[0]) * kappa, to[1] + (at[1] - to[1]) * kappa],
  point: to,
});

/**
 * Places every item in use as a lane running along the bus and every recipe as a node beside
 * it, with curved taps connecting the two. Every line is as wide as the whole number of belts
 * its flow needs at `beltPerSecond`, so a lane steps narrower only where a tap takes it below
 * a belt boundary. Player outputs leave their node on the side away from the bus instead of
 * joining it.
 */
export function layoutBus(
  data: ProductionData,
  flow: Flow,
  beltPerSecond: number,
  options: LayoutOptions = defaultLayoutOptions,
): BusLayout {
  const {
    iconSize,
    framePad,
    slotGap,
    tapGap,
    ioGap,
    laneGap,
    nodeOffset,
    widthPerBelt,
    widthPerPipe,
    linearBelts,
    maxWidth,
    cornerRadius,
    stubLength,
    exportLength,
    nodeOrder,
    laneReuse,
    outputNodes,
  } = options;
  const itemOrder = orderItems(data, flow, nodeOrder);
  const frameHalf = iconSize / 2 + framePad;
  // Each raised row sits one frame plus room for the badges below further from the bus.
  const raisedStep = frameHalf * 2 + 14;
  // Belt labels sit on the drop line, just clear of the node's frame.
  const beltLabelOffset = 12;

  // How many belts, or pumped pipes for a fluid, a flow needs.
  const carriersFor = (rate: number, item: ItemId) =>
    roundUp(rate / (isFluid(data.items[item]) ? pipePerSecond : beltPerSecond));
  // Width grows by one step per belt or pipe, then by the square root of those past
  // `linearBelts`. Each extra one never adds more than the one before, which guarantees that
  // the parts of a fork are together at least as wide as the lane they split from.
  const widthFor = (rate: number, item: ItemId) => {
    if (rate <= 1e-9) return 0;
    const carriers = Math.max(1, carriersFor(rate, item));
    const step = isFluid(data.items[item]) ? widthPerPipe : widthPerBelt;
    const width =
      carriers <= linearBelts
        ? carriers * step
        : (linearBelts + Math.sqrt(carriers - linearBelts)) * step;
    return Math.min(width, maxWidth);
  };
  // Keep the inner edge of each curve at the configured radius, whatever the stroke width.
  const radiusFor = (strokeWidth: number) => cornerRadius + strokeWidth / 2;

  // Split each item's flow into the part consumed by recipes on the bus, the part that leaves
  // as a player output, and surplus that leaves to be stored.
  const outputRateOf = (item: ItemId) => flow.outputRate.get(item) ?? 0;
  const laneRateOf = (item: ItemId) => {
    const rate =
      (flow.itemRate.get(item) ?? 0) - outputRateOf(item) - (flow.surplusRate.get(item) ?? 0);
    return rate > 1e-9 ? rate : 0;
  };
  const storedOf = (recipe: RecipeId | undefined, item: ItemId) =>
    recipe ? (flow.storedRate.get(edgeKey(recipe, item)) ?? 0) : 0;
  // What a cracker drops onto a lane: what it makes, less what is stored where it is made.
  const crackerDropOf = (recipe: RecipeId, item: ItemId) =>
    (flow.madeRate.get(edgeKey(recipe, item)) ?? 0) - storedOf(recipe, item);
  // A node's exports: player outputs from the item's main producer, then stored surplus.
  const exportsOf = (node: LayoutNode) => {
    const made = node.item ? [node.item] : Object.keys(data.recipes[node.recipe ?? ""].outputs);
    return [
      ...made
        .filter((item) => outputRateOf(item) > 0 && nodeOfItem.get(item) === node)
        .map((item) => ({ item, rate: outputRateOf(item), stored: false })),
      ...made
        .map((item) => ({ item, rate: storedOf(node.recipe, item), stored: true }))
        .filter((exported) => exported.rate > 1e-9),
    ];
  };
  // Crackers add to a lane their item's primary producer started, each with a drop of its own.
  const crackers = [
    ...new Set(
      [...flow.producersOf.values()].flatMap((producers) =>
        producers.slice(1).filter((recipe) => (flow.recipeCrafts.get(recipe) ?? 0) > 0),
      ),
    ),
  ];
  const mergesInto = (item: ItemId) =>
    crackers
      .filter((recipe) => item in data.recipes[recipe].outputs)
      .map((recipe) => ({ recipe, rate: crackerDropOf(recipe, item) }))
      .filter((merge) => merge.rate > 1e-9);
  const firstDropRate = (item: ItemId) => {
    const rate = laneRateOf(item) - mergesInto(item).reduce((sum, merge) => sum + merge.rate, 0);
    return rate > 1e-9 ? rate : 0;
  };
  const dropKey = (recipe: RecipeId, item: ItemId) => `drop:${edgeKey(recipe, item)}`;

  // Items made for a single consumer are fed straight into it instead of riding the bus; "inRow"
  // keeps every item on the bus.
  const feeds = outputNodes === "raised" ? findFeeds(data, flow) : noFeeds;
  const isFed = (item: ItemId) => feeds.fedItems.has(item);
  // A feeder's feeds leave its far edge in the order of its recipe outputs.
  const feedsOutOf = (recipe: RecipeId | undefined) =>
    Object.keys(recipe ? data.recipes[recipe].outputs : {}).flatMap((item) => {
      const fed = feeds.fedItems.get(item);
      if (!fed) return [];
      const key = edgeKey(fed.consumer, item);
      return [
        { item, key, consumer: fed.consumer, width: widthFor(flow.edgeRate.get(key) ?? 0, item) },
      ];
    });
  // Total width of lines spread side by side `tapGap` apart, as exports and feeds are.
  const spreadWidth = (widths: number[]) =>
    widths.reduce((sum, width) => sum + width + tapGap, -tapGap);
  const exportsWidthOf = (node: LayoutNode) =>
    spreadWidth(exportsOf(node).map(({ item, rate }) => widthFor(rate, item)));

  // Size one slot per producer, in production order, to fit its taps side by side. Inputs fan
  // in on the leading side and outputs that join the bus drop on the trailing side.
  interface Slot {
    node: LayoutNode;
    /** Tap keys and widths in order along the slot: inputs, then drops. */
    taps: { key: string; width: number; input?: ItemId }[];
    inputCount: number;
    splitGap: number;
    tapsWidth: number;
    exports: boolean;
    /** An output-only node outside any block, drawn in a raised row; see the placement step. */
    raised: boolean;
    /** The root recipe of the block this node belongs to, if any. */
    block?: RecipeId;
    /** Where a raised block member's taps start, in its corridor rather than centered on it. */
    tapsLeft?: number;
  }
  const nodes: LayoutNode[] = [];
  const slots: Slot[] = [];
  const nodeOfItem = new Map<ItemId, LayoutNode>();
  for (const item of itemOrder) {
    if ((flow.itemRate.get(item) ?? 0) <= 0) continue;
    const recipeId = flow.producerOf.get(item);
    const id = recipeId ? `recipe:${recipeId}` : `raw:${item}`;
    const existing = nodes.find((node) => node.id === id);
    if (existing) {
      nodeOfItem.set(item, existing);
      continue;
    }
    const node: LayoutNode = {
      id,
      kind: recipeId ? "recipe" : "raw",
      item: recipeId ? undefined : item,
      recipe: recipeId,
      along: 0,
      across: -nodeOffset,
      length: 0,
    };
    nodes.push(node);
    nodeOfItem.set(item, node);

    const recipe = recipeId ? data.recipes[recipeId] : undefined;
    // Fed items meet their nodes directly, so only the lines that meet the bus get taps.
    const inputs = recipe ? Object.keys(recipe.inputs).filter((input) => !isFed(input)) : [];
    const outputs = recipe
      ? Object.keys(recipe.outputs).filter((output) => (flow.itemRate.get(output) ?? 0) > 0)
      : [];
    for (const output of outputs) nodeOfItem.set(output, node);
    // A raw resource drops onto the bus like a recipe's output.
    const drops = (recipe ? outputs : [item]).filter(
      (output) => laneRateOf(output) > 0 && !isFed(output),
    );
    const taps = [
      ...inputs.map((input) => ({
        input,
        key: edgeKey(recipe?.id ?? "", input),
        width: widthFor(flow.edgeRate.get(edgeKey(recipe?.id ?? "", input)) ?? 0, input),
      })),
      ...drops.map((output) => ({
        key: `out:${output}`,
        width: widthFor(firstDropRate(output), output),
      })),
    ];
    // Inputs and outputs are separated by `ioGap` instead of `tapGap` when a node has both.
    const splitGap = inputs.length > 0 && drops.length > 0 ? ioGap - tapGap : 0;
    const tapsWidth = taps.reduce((sum, tap) => sum + tap.width + tapGap, tapGap) + splitGap;
    const exported = exportsOf(node);
    const exportsWidth = exportsWidthOf(node) + tapGap * 2;
    const feedsWidth = spreadWidth(feedsOutOf(recipeId).map(({ width }) => width)) + tapGap * 2;
    // The frame stretches along the bus so every line that meets it lands on it.
    node.length = Math.max(frameHalf * 2, tapsWidth, exportsWidth, feedsWidth);
    slots.push({
      node,
      taps,
      inputCount: inputs.length,
      splitGap,
      tapsWidth,
      exports: exported.length > 0,
      raised:
        outputNodes === "raised" &&
        !feeds.levelOf.has(recipeId ?? "") &&
        inputs.length > 0 &&
        drops.length === 0,
    });
  }

  // Give each cracker a slot right after the last node making one of its inputs, so heavy oil
  // cracking follows the refinery and light oil cracking follows heavy oil cracking. A cracker's
  // outputs join lanes that already exist, so it is never an output-only node.
  const unplaced = [...crackers];
  while (unplaced.length) {
    const ready =
      unplaced.find((recipe) =>
        Object.keys(data.recipes[recipe].inputs).every((input) =>
          unplaced.every((other) => other === recipe || !(input in data.recipes[other].outputs)),
        ),
      ) ?? unplaced[0];
    unplaced.splice(unplaced.indexOf(ready), 1);
    const recipe = data.recipes[ready];
    const node: LayoutNode = {
      id: `recipe:${ready}`,
      kind: "recipe",
      recipe: ready,
      along: 0,
      across: -nodeOffset,
      length: 0,
    };
    const inputs = Object.keys(recipe.inputs);
    const drops = Object.keys(recipe.outputs).filter(
      (output) => crackerDropOf(ready, output) > 1e-9,
    );
    const taps = [
      ...inputs.map((input) => ({
        input,
        key: edgeKey(ready, input),
        width: widthFor(flow.edgeRate.get(edgeKey(ready, input)) ?? 0, input),
      })),
      ...drops.map((output) => ({
        key: dropKey(ready, output),
        width: widthFor(crackerDropOf(ready, output), output),
      })),
    ];
    const splitGap = inputs.length > 0 && drops.length > 0 ? ioGap - tapGap : 0;
    const tapsWidth = taps.reduce((sum, tap) => sum + tap.width + tapGap, tapGap) + splitGap;
    const exported = exportsOf(node);
    node.length = Math.max(frameHalf * 2, tapsWidth, exportsWidthOf(node) + tapGap * 2);
    const makesInput = (slot: Slot) =>
      inputs.some(
        (input) =>
          nodeOfItem.get(input) === slot.node ||
          input in (data.recipes[slot.node.recipe ?? ""]?.outputs ?? {}),
      );
    const after = slots.findLastIndex(makesInput);
    slots.splice(after + 1, 0, {
      node,
      taps,
      inputCount: inputs.length,
      splitGap,
      tapsWidth,
      exports: exported.length > 0,
      raised: false,
    });
    nodes.push(node);
  }

  // Place the slots along the bus. Main-row nodes sit `slotGap` apart. A raised node waits
  // until the main-row node making its last input is placed, then goes into the gap right
  // after it: the main row leaves a corridor there just wide enough for its taps, and the
  // node takes the lowest raised row where
  //  - its frame is clear of the row's other frames,
  //  - its taps pass between the frames of the raised rows below it,
  //  - nothing from below (taps to higher rows, exports) runs into its frame, and
  //  - its own exports do not run into a frame in the row above.
  // A block waits the same way for the last bus input of any of its members, then goes into
  // the gap as one unit, with each consumer raised over its feeders, and steps along the bus
  // until its frames and lines all clear what is already placed.
  const tapAlong = new Map<string, number>();
  const setTaps = (slot: Slot) => {
    let tapCursor = (slot.tapsLeft ?? slot.node.along - slot.tapsWidth / 2) + tapGap;
    slot.taps.forEach((tap, index) => {
      if (index === slot.inputCount) tapCursor += slot.splitGap;
      tapAlong.set(tap.key, tapCursor + tap.width / 2);
      tapCursor += tap.width + tapGap;
    });
  };
  // Mark each block member with its root, so it leaves the main row and moves with its block.
  const slotOf = new Map(slots.map((slot) => [slot.node.recipe ?? slot.node.id, slot]));
  const membersOf = (recipe: RecipeId): RecipeId[] => [
    ...(feeds.feedersOf.get(recipe) ?? []).flatMap(membersOf),
    recipe,
  ];
  for (const root of feeds.roots) {
    for (const member of membersOf(root)) {
      const slot = slotOf.get(member);
      if (slot) slot.block = root;
    }
  }
  const mainSlots = slots.filter((slot) => !slot.raised && slot.block === undefined);

  // A raised node or block goes in the gap after the main-row node making the last of its bus
  // inputs. An input dropped by an earlier block's root takes that block's gap instead.
  const anchorOfNode = new Map<LayoutNode, number>();
  const raisedAfter = new Map<number, Slot[]>();
  for (const slot of slots.filter(
    (candidate) =>
      candidate.raised ||
      (candidate.block !== undefined && candidate.block === candidate.node.recipe),
  )) {
    const members = slot.block === undefined ? [slot.node.recipe ?? ""] : membersOf(slot.block);
    // With every input closing a loop there is no anchor, and -1 places it before the main row.
    const anchor = Math.max(
      -1,
      ...members.flatMap((recipeId) =>
        Object.keys(data.recipes[recipeId].inputs)
          .filter((input) => !isFed(input) && !flow.backEdges.has(edgeKey(recipeId, input)))
          .flatMap((input) => {
            const producer = nodeOfItem.get(input);
            return [
              (producer && anchorOfNode.get(producer)) ??
                mainSlots.findIndex((main) => main.node === producer),
              // A cracker adding to an input counts too, so the node does not tap the lane early.
              ...mergesInto(input).map(({ recipe: cracker }) =>
                mainSlots.findIndex((main) => main.node.recipe === cracker),
              ),
            ];
          }),
      ),
    );
    anchorOfNode.set(slot.node, anchor);
    raisedAfter.set(anchor, [...(raisedAfter.get(anchor) ?? []), slot]);
  }

  // Intervals along the bus, per raised row (index 1 is the row nearest the main row): the
  // frames in it, and the spans its frames must avoid because lines pass through there. Index 0
  // holds the main-row frames of blocks. Rows are added as they are used, since a block is as
  // tall as its tree.
  type Span = [number, number];
  const frames: Span[][] = [];
  const blocked: Span[][] = [];
  const spansOf = (list: Span[][], row: number) => {
    while (list.length <= row) list.push([]);
    return list[row];
  };
  const overlaps = (spans: Span[], [a, b]: Span, clearance: number) =>
    spans.some(([c, d]) => a < d + clearance && c < b + clearance);
  // Clearance between a line and a raised frame it passes, and between raised frames.
  const lineClear = 5;

  const tryRaise = (slot: Slot, corridorLeft: number) => {
    const along = corridorLeft + slot.tapsWidth / 2;
    const frame: Span = [along - slot.node.length / 2, along + slot.node.length / 2];
    const lines: Span = [corridorLeft + tapGap, corridorLeft + slot.tapsWidth - tapGap];
    const exportsHalf = exportsWidthOf(slot.node) / 2;
    const exportSpan: Span = [along - exportsHalf, along + exportsHalf];
    // Stop two rows above the highest frame: taps blocked lower down block every higher row too,
    // and the row just above can only be blocked by that frame's exports.
    const highestRow = frames.findLastIndex((spans) => spans.length > 0);
    for (let row = 1; row <= Math.max(highestRow, 0) + 2; row++) {
      if (
        overlaps(spansOf(frames, row), frame, slotGap) ||
        overlaps(spansOf(blocked, row), frame, lineClear)
      )
        continue;
      let below = 1;
      while (below < row && !overlaps(frames[below], lines, lineClear)) below++;
      if (below < row) continue;
      if (overlaps(spansOf(frames, row + 1), exportSpan, lineClear)) continue;
      slot.node.along = along;
      slot.node.across = -nodeOffset - row * raisedStep;
      setTaps(slot);
      frames[row].push(frame);
      for (let lower = 1; lower < row; lower++) blocked[lower].push(lines);
      spansOf(blocked, row + 1).push(exportSpan);
      return true;
    }
    return false;
  };

  // A block's layout before it is placed: its members' positions, its frames and the spans its
  // lines pass through per row, and the root's exports.
  interface BlockPlan {
    members: { slot: Slot; along: number; length: number; row: number; tapsLeft?: number }[];
    feedSpans: Map<string, Span>;
    frames: Span[][];
    lines: Span[][];
    exportRow: number;
    exportSpan?: Span;
    cursor: number;
  }
  // Lay out a block whose first main-row frame starts at `left`. Each member's feeders go first,
  // left to right, so a raised member sits over its feeds, with a corridor on its trailing side
  // for the taps and drops it has on the bus.
  const layoutBlock = (root: RecipeId, left: number) => {
    const plan: BlockPlan = {
      members: [],
      feedSpans: new Map(),
      frames: [],
      lines: [],
      exportRow: 0,
      cursor: left,
    };
    const place = (recipe: RecipeId) => {
      for (const feeder of feeds.feedersOf.get(recipe) ?? []) place(feeder);
      const slot = slotOf.get(recipe);
      if (!slot) return;
      const row = feeds.levelOf.get(recipe) ?? 0;
      const outgoing = feedsOutOf(recipe);
      const outgoingWidth = spreadWidth(outgoing.map(({ width }) => width));
      let frame: Span = [plan.cursor, plan.cursor + slot.node.length];
      let tapsLeft: number | undefined;
      if (row > 0) {
        tapsLeft = plan.cursor - slotGap / 2;
        const corridorRight = tapsLeft + slot.tapsWidth;
        const feedLefts = Object.keys(data.recipes[recipe].inputs).flatMap((input) => {
          const span = plan.feedSpans.get(edgeKey(recipe, input));
          return span ? [span[0]] : [];
        });
        const frameLeft = Math.min(...feedLefts) - tapGap;
        const minLength = Math.max(
          frameHalf * 2,
          exportsWidthOf(slot.node) + tapGap * 2,
          outgoingWidth + tapGap * 2,
        );
        frame = [frameLeft, Math.max(corridorRight, frameLeft + minLength)];
        if (slot.taps.length > 0) {
          for (let lower = 1; lower < row; lower++) {
            spansOf(plan.lines, lower).push([tapsLeft + tapGap, corridorRight - tapGap]);
          }
        }
      }
      const along = (frame[0] + frame[1]) / 2;
      plan.members.push({ slot, along, length: frame[1] - frame[0], row, tapsLeft });
      spansOf(plan.frames, row).push(frame);
      plan.cursor = frame[1] + slotGap;
      // Feeds leave the far edge side by side, centered on it like exports.
      let feedCursor = along - outgoingWidth / 2;
      for (const { key, consumer, width } of outgoing) {
        plan.feedSpans.set(key, [feedCursor, feedCursor + width]);
        const consumerRow = feeds.levelOf.get(consumer) ?? 0;
        for (let between = row + 1; between < consumerRow; between++) {
          spansOf(plan.lines, between).push([feedCursor, feedCursor + width]);
        }
        feedCursor += width + tapGap;
      }
      if (recipe === root && slot.exports) {
        const exportsHalf = exportsWidthOf(slot.node) / 2;
        plan.exportRow = row + 1;
        plan.exportSpan = [along - exportsHalf, along + exportsHalf];
      }
    };
    place(root);
    return plan;
  };
  const blockFits = (plan: BlockPlan) =>
    plan.frames.every((spans, row) =>
      spans.every(
        (frame) =>
          !overlaps(spansOf(frames, row), frame, slotGap) &&
          !overlaps(spansOf(blocked, row), frame, lineClear),
      ),
    ) &&
    plan.lines.every((spans, row) =>
      spans.every((line) => !overlaps(spansOf(frames, row), line, lineClear)),
    ) &&
    (!plan.exportSpan || !overlaps(spansOf(frames, plan.exportRow), plan.exportSpan, lineClear));
  const feedSpans = new Map<string, Span>();
  const placeBlock = (plan: BlockPlan) => {
    for (const { slot, along, length, row, tapsLeft } of plan.members) {
      slot.node.along = along;
      slot.node.length = length;
      slot.node.across = -nodeOffset - row * raisedStep;
      slot.tapsLeft = tapsLeft;
      setTaps(slot);
    }
    for (const [key, span] of plan.feedSpans) feedSpans.set(key, span);
    plan.frames.forEach((spans, row) => {
      spansOf(frames, row).push(...spans);
    });
    plan.lines.forEach((spans, row) => {
      spansOf(blocked, row).push(...spans);
    });
    if (plan.exportSpan) spansOf(blocked, plan.exportRow).push(plan.exportSpan);
  };

  let cursor = slotGap;
  // Fill the gap ending at `cursor` with the raised nodes and blocks anchored there, in order,
  // each corridor `slotGap / 2` clear of the one before. A node or block that does not fit
  // widens the gap instead of moving to a later one, so the main-row node before it is always
  // one of its inputs.
  const fillGap = (raised: Slot[]) => {
    let corridorLeft = cursor - slotGap / 2;
    for (const slot of raised) {
      if (slot.block !== undefined) {
        let plan = layoutBlock(slot.block, corridorLeft + slotGap / 2);
        while (!blockFits(plan)) {
          corridorLeft += tapGap * 2;
          plan = layoutBlock(slot.block, corridorLeft + slotGap / 2);
        }
        placeBlock(plan);
        cursor = plan.cursor;
        corridorLeft = cursor - slotGap / 2;
        continue;
      }
      while (!tryRaise(slot, corridorLeft)) corridorLeft += tapGap * 2;
      corridorLeft += slot.tapsWidth + slotGap / 2;
      cursor = corridorLeft + slotGap / 2;
    }
  };
  fillGap(raisedAfter.get(-1) ?? []);
  mainSlots.forEach((slot, index) => {
    let left = cursor;
    // An exporting node must not sit under a raised frame, since its export would run into it.
    const exportsHalf = exportsWidthOf(slot.node) / 2;
    if (slot.exports) {
      let moved = true;
      while (moved) {
        const center = left + slot.node.length / 2;
        const clash = spansOf(frames, 1).find(
          ([a, b]) => center - exportsHalf < b + lineClear && a < center + exportsHalf + lineClear,
        );
        moved = clash !== undefined;
        if (clash) left = clash[1] + lineClear + exportsHalf - slot.node.length / 2;
      }
    }
    slot.node.along = left + slot.node.length / 2;
    setTaps(slot);
    cursor = left + slot.node.length + slotGap;
    if (slot.exports) {
      spansOf(blocked, 1).push([slot.node.along - exportsHalf, slot.node.along + exportsHalf]);
    }
    fillGap(raisedAfter.get(index) ?? []);
  });
  const raisedRight = Math.max(...frames.flat().map(([, b]) => b));
  const alongMax = Math.max(cursor, raisedRight + slotGap);
  // Taps end at the edge of the row their node sits in.
  const nodeEdgeOf = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    return (node?.across ?? -nodeOffset) + frameHalf;
  };

  // Each item's consumers in bus order, and the stretch of bus its lane occupies.
  interface Consumer {
    recipe: RecipeId;
    along: number;
    rate: number;
    backEdge: boolean;
  }
  /** A cracker's drop that joins an item's lane after the lane has started. */
  interface Merge {
    recipe: RecipeId;
    along: number;
    rate: number;
  }
  interface Interval {
    item: ItemId;
    from: number;
    to: number;
    consumers: Consumer[];
    merges: Merge[];
    remainder: number;
  }
  const buildIntervals = () => {
    const intervals: Interval[] = [];
    for (const item of itemOrder) {
      const node = nodeOfItem.get(item);
      const laneRate = laneRateOf(item);
      // A fed item goes straight to its consumer and takes no lane.
      if (!node || laneRate <= 0 || isFed(item)) continue;
      const from = tapAlong.get(`out:${item}`) ?? node.along;
      const consumers: Consumer[] = [];
      for (const [recipeId, recipe] of Object.entries(data.recipes)) {
        const along = tapAlong.get(edgeKey(recipeId, item));
        if (!(item in recipe.inputs) || along === undefined) continue;
        consumers.push({
          recipe: recipeId,
          along,
          rate: flow.edgeRate.get(edgeKey(recipeId, item)) ?? 0,
          backEdge: flow.backEdges.has(edgeKey(recipeId, item)),
        });
      }
      consumers.sort((a, b) => a.along - b.along);
      const merges = mergesInto(item)
        .map((merge) => ({ ...merge, along: tapAlong.get(dropKey(merge.recipe, item)) ?? from }))
        .filter((merge) => merge.along > from)
        .sort((a, b) => a.along - b.along);
      const forward = consumers.filter((consumer) => !consumer.backEdge && consumer.along > from);
      const consumed = forward.reduce((sum, consumer) => sum + consumer.rate, 0);
      const remainder = laneRate - consumed;
      const lastTap = forward.length
        ? forward[forward.length - 1].along + widthFor(forward[forward.length - 1].rate, item) / 2
        : from;
      const to = remainder > 1e-9 ? Math.max(lastTap, from) + stubLength : lastTap;
      intervals.push({ item, from, to, consumers, merges, remainder });
    }
    return intervals.sort((a, b) => a.from - b.from);
  };
  let intervals = buildIntervals();

  // Assign lanes in order of arrival; lane indices count up in creation order.
  //  - "noCrossing": an item may only take an existing lane when every lane nearer the nodes
  //    is vacant where it enters, so a drop never crosses an occupied lane. Of that vacant run
  //    it takes the lane farthest from the nodes, leaving the nearer ones for later items.
  //  - "greedy": the lowest-numbered vacant lane, which uses the fewest lanes but can drop
  //    across lanes that are still in use.
  const laneFreeAfter: number[] = [];
  const laneOfItem = new Map<ItemId, number>();
  for (const interval of intervals) {
    // A lane is vacant once its previous occupant has ended before this item's drop stroke
    // begins. The previous item's final turn and this item's drop may share a slot, since the
    // turn sits on the leading side and the drop on the trailing side, curving forward; the
    // slot's own tap padding already separates them, so the comparison is inclusive.
    const startEdge = interval.from - widthFor(laneRateOf(interval.item), interval.item) / 2;
    const vacant = (lane: number) => laneFreeAfter[lane] <= startEdge + 1e-6;
    let lane = laneFreeAfter.length;
    if (laneReuse === "noCrossing") {
      while (lane > 0 && vacant(lane - 1)) lane--;
    } else {
      const free = laneFreeAfter.findIndex((_, index) => vacant(index));
      if (free !== -1) lane = free;
    }
    laneFreeAfter[lane] = interval.to;
    laneOfItem.set(interval.item, lane);
  }

  // Put the lanes in order across the bus with the newest nearest the nodes, the order a bus is
  // built in. No-crossing reuse relies on it.
  const nearestFirst = laneFreeAfter.map((_, lane) => lane).reverse();

  // Order each node's input taps by lane, nearest the nodes first, so a near lane turns up and
  // ends before the farther lanes turn up past it. Inputs stay ahead of the node's drops, so no
  // lane's vacancy at a drop changes and the lane assignment above still holds.
  const laneRank = (input: ItemId | undefined) => {
    const lane = input === undefined ? undefined : laneOfItem.get(input);
    return lane === undefined ? Infinity : nearestFirst.indexOf(lane);
  };
  for (const slot of slots) {
    const inputTaps = slot.taps
      .slice(0, slot.inputCount)
      .sort((a, b) => laneRank(a.input) - laneRank(b.input));
    slot.taps.splice(0, slot.inputCount, ...inputTaps);
    setTaps(slot);
  }
  intervals = buildIntervals();

  // Lanes are stacked by their widest occupant. `base` is a lane's far edge; its lines occupy
  // [base - width, base], so narrowing happens on the node side where taps leave.
  // A lane counts in belts or pipes, whichever its busiest occupant needs more of.
  const laneMaxWidth = laneFreeAfter.map(() => 0);
  const laneBelts = laneFreeAfter.map(() => 0);
  const lanePipes = laneFreeAfter.map(() => 0);
  for (const { item } of intervals) {
    const lane = laneOfItem.get(item) ?? 0;
    const rate = laneRateOf(item);
    laneMaxWidth[lane] = Math.max(laneMaxWidth[lane], widthFor(rate, item));
    const counts = isFluid(data.items[item]) ? lanePipes : laneBelts;
    counts[lane] = Math.max(counts[lane], carriersFor(rate, item));
  }
  const laneBase: number[] = [];
  let acrossCursor = 0;
  for (const lane of nearestFirst) {
    acrossCursor += laneMaxWidth[lane];
    laneBase[lane] = acrossCursor;
    acrossCursor += laneGap;
  }

  // Build each item's drawing: the drop from its producer merges into the first lane segment,
  // every tap peels off the near edge with a curve and the lane steps narrower past it, every
  // later drop from a cracker curves in on the near edge and the lane steps wider past it, and
  // the last consumer turns the whole remaining lane toward its node.
  const paths: LayoutPath[] = [];
  const laneHeads: LaneHead[] = [];
  for (const interval of intervals) {
    const { item, from, consumers, merges, remainder } = interval;
    const node = nodeOfItem.get(item);
    if (!node) continue;
    const base = laneBase[laneOfItem.get(item) ?? 0];
    let remaining = laneRateOf(item) - merges.reduce((sum, merge) => sum + merge.rate, 0);
    let width = widthFor(remaining, item);
    let center = base - width / 2;
    let order = 0;
    let fromNode: string | undefined = node.id;
    const headRadius = radiusFor(width);
    laneHeads.push({
      item,
      pathId: `lane:${item}:0`,
      along: from,
      across: node.across + frameHalf + beltLabelOffset,
      rate: remaining,
    });
    let commands: PathCommand[] = [
      { type: "M", point: [from, node.across + frameHalf] },
      { type: "L", point: [from, center - headRadius] },
      corner([from, center - headRadius], [from, center], [from + headRadius, center]),
    ];

    const events = [
      ...consumers.map((consumer) => ({ along: consumer.along, consumer })),
      ...merges.map((merge) => ({ along: merge.along, merge })),
    ].sort((a, b) => a.along - b.along);
    for (const [index, event] of events.entries()) {
      if ("merge" in event) {
        const { merge } = event;
        const dropWidth = widthFor(merge.rate, item);
        const widerWidth = widthFor(remaining + merge.rate, item);
        const r = radiusFor(dropWidth);
        // The drop hugs the wider lane's near edge and curves forward into it, mirroring a tap.
        // The narrower lane runs on to where the curve ends, and the wider one starts there.
        const dropCenter = base - widerWidth + dropWidth / 2;
        const fromCracker = `recipe:${merge.recipe}`;
        commands.push({ type: "L", point: [merge.along + r, center] });
        paths.push({
          id: `lane:${item}:${order}`,
          item,
          kind: "lane",
          fromNode,
          order,
          width,
          rate: remaining,
          backEdge: false,
          commands,
        });
        order++;
        laneHeads.push({
          item,
          pathId: `drop:${merge.recipe}:${item}`,
          along: merge.along,
          across: nodeEdgeOf(fromCracker) + beltLabelOffset,
          rate: merge.rate,
        });
        paths.push({
          id: `drop:${merge.recipe}:${item}`,
          item,
          kind: "lane",
          fromNode: fromCracker,
          order,
          width: dropWidth,
          rate: merge.rate,
          backEdge: false,
          commands: [
            { type: "M", point: [merge.along, nodeEdgeOf(fromCracker)] },
            { type: "L", point: [merge.along, dropCenter - r] },
            corner(
              [merge.along, dropCenter - r],
              [merge.along, dropCenter],
              [merge.along + r, dropCenter],
            ),
          ],
        });
        fromNode = undefined;
        remaining += merge.rate;
        width = widerWidth;
        center = base - width / 2;
        commands = [{ type: "M", point: [merge.along + r, center] }];
        continue;
      }
      const { consumer } = event;
      const toNode = `recipe:${consumer.recipe}`;
      const consumerEdge = nodeEdgeOf(toNode);
      if (consumer.backEdge || consumer.along <= from) {
        // A consumer behind its producer closes a loop; draw a plain dashed tap so it is visible
        // without disturbing the forward widths.
        paths.push({
          id: `tap:${consumer.recipe}:${item}`,
          item,
          kind: "tap",
          toNode,
          order: -1,
          width: Math.max(widthPerBelt, widthFor(consumer.rate, item)),
          rate: consumer.rate,
          backEdge: true,
          commands: [
            { type: "M", point: [consumer.along, center] },
            { type: "L", point: [consumer.along, consumerEdge] },
          ],
        });
        continue;
      }
      const after = remaining - consumer.rate;
      const mergesAhead = events.slice(index + 1).some((later) => "merge" in later);
      if (after <= 1e-9 && !mergesAhead) {
        // Everything left turns up into this consumer, so the last segment and its tap are one stroke.
        const r = radiusFor(width);
        commands.push(
          { type: "L", point: [consumer.along - r, center] },
          corner(
            [consumer.along - r, center],
            [consumer.along, center],
            [consumer.along, center - r],
          ),
          { type: "L", point: [consumer.along, consumerEdge] },
        );
        paths.push({
          id: `lane:${item}:${order}`,
          item,
          kind: "lane",
          fromNode,
          toNode,
          order,
          width,
          rate: remaining,
          backEdge: false,
          commands,
        });
        commands = [];
        remaining = 0;
        break;
      }
      const tapWidth = widthFor(consumer.rate, item);
      const afterWidth = widthFor(after, item);
      // The tap hugs the lane's near edge and the rest of the lane its far edge. Rounding to
      // whole belts can make the two wider together than the lane, in which case they overlap
      // in the same color, but they never leave a gap.
      const tapCenter = base - width + tapWidth / 2;
      const r = radiusFor(tapWidth);
      // The wide segment ends where the branch begins to curve. From there the narrower
      // segment and the tap together cover the full width, so the fork has no step and the
      // tap's far edge leaves the remaining lane as a smooth fillet.
      commands.push({ type: "L", point: [consumer.along - r, center] });
      paths.push({
        id: `lane:${item}:${order}`,
        item,
        kind: "lane",
        fromNode,
        order,
        width,
        rate: remaining,
        backEdge: false,
        commands,
      });
      paths.push({
        id: `tap:${consumer.recipe}:${item}`,
        item,
        kind: "tap",
        toNode,
        order,
        width: tapWidth,
        rate: consumer.rate,
        backEdge: false,
        commands: [
          { type: "M", point: [consumer.along - r, tapCenter] },
          corner(
            [consumer.along - r, tapCenter],
            [consumer.along, tapCenter],
            [consumer.along, tapCenter - r],
          ),
          { type: "L", point: [consumer.along, consumerEdge] },
        ],
      });
      order++;
      fromNode = undefined;
      remaining = after;
      width = afterWidth;
      center = base - width / 2;
      commands = [{ type: "M", point: [consumer.along - r, center] }];
    }
    if (commands.length && remainder > 1e-9) {
      commands.push({ type: "L", point: [interval.to, center] });
      paths.push({
        id: `lane:${item}:${order}`,
        item,
        kind: "lane",
        fromNode,
        order,
        width,
        rate: remaining,
        backEdge: false,
        commands,
      });
    }
  }

  // Fed items skip the bus, so they are drawn after the lanes as lines between frames.
  for (const [item, { producer, consumer }] of feeds.fedItems) {
    const key = edgeKey(consumer, item);
    const [left, right] = feedSpans.get(key) ?? [0, 0];
    const along = (left + right) / 2;
    const rate = flow.edgeRate.get(key) ?? 0;
    const id = `tap:${consumer}:${item}`;
    const fromEdge = (nodeOfItem.get(item)?.across ?? -nodeOffset) - frameHalf;
    const toEdge = nodeEdgeOf(`recipe:${consumer}`);
    paths.push({
      id,
      item,
      kind: "tap",
      fromNode: `recipe:${producer}`,
      toNode: `recipe:${consumer}`,
      order: 0,
      width: widthFor(rate, item),
      rate,
      backEdge: false,
      commands: [
        { type: "M", point: [along, fromEdge] },
        { type: "L", point: [along, toEdge] },
      ],
    });
    laneHeads.push({ item, pathId: id, along, across: (fromEdge + toEdge) / 2, rate });
  }

  // Player outputs and stored surplus leave their node on the side away from the bus, spread
  // across its far edge.
  for (const node of nodes) {
    const exported = exportsOf(node);
    const widths = exported.map(({ item, rate }) => widthFor(rate, item));
    const total = widths.reduce((sum, width) => sum + width + tapGap, -tapGap);
    let exportCursor = node.along - total / 2;
    const edge = node.across - frameHalf;
    exported.forEach(({ item: output, rate, stored }, index) => {
      const along = exportCursor + widths[index] / 2;
      exportCursor += widths[index] + tapGap;
      paths.push({
        id: stored ? `stored:${node.recipe}:${output}` : `export:${output}`,
        item: output,
        kind: "export",
        stored,
        fromNode: node.id,
        order: -1,
        width: widths[index],
        rate,
        backEdge: false,
        commands: [
          { type: "M", point: [along, edge] },
          { type: "L", point: [along, edge - exportLength] },
        ],
      });
    });
  }

  return {
    nodes,
    paths,
    laneHeads,
    bounds: {
      alongMin: 0,
      alongMax,
      // The topmost row's frames and exports.
      acrossMin:
        Math.min(-nodeOffset, ...nodes.map((node) => node.across)) - frameHalf - exportLength,
      acrossMax: acrossCursor,
    },
    busWidth: {
      lanes: laneFreeAfter.length,
      belts: laneBelts.reduce(
        (sum, belts, lane) => sum + (belts >= lanePipes[lane] ? belts : 0),
        0,
      ),
      pipes: lanePipes.reduce((sum, pipes, lane) => sum + (pipes > laneBelts[lane] ? pipes : 0), 0),
    },
  };
}
