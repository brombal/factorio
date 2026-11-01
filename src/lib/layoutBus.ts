import type { ItemId, ProductionData, RecipeId } from "../data/types.ts";
import { roundUp } from "../util/roundUp.ts";
import { edgeKey, type Flow } from "./computeFlow.ts";
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
  /** Belt count past which each extra belt adds less width, so rare very wide lanes stay readable. */
  linearBelts: number;
  /** Widest a line is ever drawn. */
  maxWidth: number;
  /** Radius of the inner edge of every curve; the centerline radius grows with the line's width. */
  cornerRadius: number;
  /** How far a lane runs past its last consumer when flow is left over, which only happens around loops. */
  stubLength: number;
  /** How far an output export, the line for a player output, extends away from the bus. */
  exportLength: number;
  /** How items are ordered along the bus; see `orderItems`. */
  nodeOrder: NodeOrder;
  /** When an item may take over a lane whose previous occupant has ended; see the lane step. */
  laneReuse: LaneReuse;
  /** Whether nodes that only make player outputs move to raised rows; see the placement step. */
  outputNodes: OutputNodes;
  /** How many raised rows output-only nodes may use. */
  raisedRows: number;
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
  linearBelts: 6,
  maxWidth: 28,
  cornerRadius: 6,
  stubLength: 24,
  exportLength: 28,
  nodeOrder: "depth",
  laneReuse: "greedy",
  outputNodes: "raised",
  raisedRows: 3,
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
   * with the turn into the last consumer. "tap" branches off a lane into a consumer. "export"
   * is a player output leaving its node away from the bus.
   */
  kind: "lane" | "tap" | "export";
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
   * How wide the bus is to build: its lanes, and its belts of the chosen tier, where each lane
   * counts as many belts as its busiest item needs at full rate.
   */
  busWidth: { lanes: number; belts: number };
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
    linearBelts,
    maxWidth,
    cornerRadius,
    stubLength,
    exportLength,
    nodeOrder,
    laneReuse,
    outputNodes,
    raisedRows,
  } = options;
  const itemOrder = orderItems(data, flow, nodeOrder);
  const frameHalf = iconSize / 2 + framePad;
  const nodeEdge = -nodeOffset + frameHalf;
  // Each raised row sits one frame plus room for the badges below further from the bus.
  const raisedStep = frameHalf * 2 + 14;
  // Belt labels sit on the drop line, just clear of the node's frame.
  const beltLabelOffset = 12;

  // Width grows by one step per belt, then by the square root of the belts past
  // `linearBelts`. Each extra belt never adds more than the one before, which guarantees that
  // the parts of a fork are together at least as wide as the lane they split from.
  const widthFor = (rate: number) => {
    if (rate <= 1e-9) return 0;
    const belts = Math.max(1, roundUp(rate / beltPerSecond));
    const width =
      belts <= linearBelts
        ? belts * widthPerBelt
        : (linearBelts + Math.sqrt(belts - linearBelts)) * widthPerBelt;
    return Math.min(width, maxWidth);
  };
  // Keep the inner edge of each curve at the configured radius, whatever the stroke width.
  const radiusFor = (strokeWidth: number) => cornerRadius + strokeWidth / 2;

  // Split each item's demand into the part consumed by recipes on the bus and the part that
  // leaves as a player output.
  const outputRateOf = (item: ItemId) => flow.outputRate.get(item) ?? 0;
  const laneRateOf = (item: ItemId) => {
    const rate = (flow.itemRate.get(item) ?? 0) - outputRateOf(item);
    return rate > 1e-9 ? rate : 0;
  };

  // Size one slot per producer, in production order, to fit its taps side by side. Inputs fan
  // in on the leading side and outputs that join the bus drop on the trailing side.
  interface Slot {
    node: LayoutNode;
    /** Tap keys and widths in order along the slot: inputs, then drops. */
    taps: { key: string; width: number }[];
    inputCount: number;
    splitGap: number;
    tapsWidth: number;
    exports: boolean;
    /** An output-only node, drawn in the raised row; see the placement step. */
    raised: boolean;
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
    const inputs = recipe ? Object.keys(recipe.inputs) : [];
    const outputs = recipe
      ? Object.keys(recipe.outputs).filter((output) => (flow.itemRate.get(output) ?? 0) > 0)
      : [];
    for (const output of outputs) nodeOfItem.set(output, node);
    // A raw resource drops onto the bus like a recipe's output.
    const drops = (recipe ? outputs : [item]).filter((output) => laneRateOf(output) > 0);
    const taps = [
      ...inputs.map((input) => ({
        key: edgeKey(recipe?.id ?? "", input),
        width: widthFor(flow.edgeRate.get(edgeKey(recipe?.id ?? "", input)) ?? 0),
      })),
      ...drops.map((output) => ({ key: `out:${output}`, width: widthFor(laneRateOf(output)) })),
    ];
    // Inputs and outputs are separated by `ioGap` instead of `tapGap` when a node has both.
    const splitGap = inputs.length > 0 && drops.length > 0 ? ioGap - tapGap : 0;
    const tapsWidth = taps.reduce((sum, tap) => sum + tap.width + tapGap, tapGap) + splitGap;
    const exported = (recipe ? outputs : [item]).filter((output) => outputRateOf(output) > 0);
    const exportsWidth = exported.reduce(
      (sum, output) => sum + widthFor(outputRateOf(output)) + tapGap,
      tapGap,
    );
    // The frame stretches along the bus so every line that meets it lands on it.
    node.length = Math.max(frameHalf * 2, tapsWidth, exportsWidth);
    slots.push({
      node,
      taps,
      inputCount: inputs.length,
      splitGap,
      tapsWidth,
      exports: exported.length > 0,
      raised: outputNodes === "raised" && inputs.length > 0 && drops.length === 0,
    });
  }

  // Place the slots along the bus. Main-row nodes sit `slotGap` apart. A raised node waits
  // until the main-row node making its last input is placed, then goes into the next gap
  // where it fits: the main row leaves a corridor there just wide enough for its taps, and
  // the node takes the lowest raised row where
  //  - its frame is clear of the row's other frames,
  //  - its taps pass between the frames of the raised rows below it,
  //  - nothing from below (taps to higher rows, exports) runs into its frame, and
  //  - its own exports do not run into a frame in the row above.
  const tapAlong = new Map<string, number>();
  const setTaps = (slot: Slot) => {
    let tapCursor = slot.node.along - slot.tapsWidth / 2 + tapGap;
    slot.taps.forEach((tap, index) => {
      if (index === slot.inputCount) tapCursor += slot.splitGap;
      tapAlong.set(tap.key, tapCursor + tap.width / 2);
      tapCursor += tap.width + tapGap;
    });
  };
  const exportsWidthOf = (node: LayoutNode) =>
    (node.item ? [node.item] : Object.keys(data.recipes[node.recipe ?? ""].outputs))
      .filter((output) => outputRateOf(output) > 0)
      .reduce((sum, output) => sum + widthFor(outputRateOf(output)) + tapGap, -tapGap);
  const mainSlots = slots.filter((slot) => !slot.raised);
  const raisedAfter = new Map<number, Slot[]>();
  for (const slot of slots.filter((candidate) => candidate.raised)) {
    const recipe = data.recipes[slot.node.recipe ?? ""];
    // With every input closing a loop there is no anchor, and -1 places it before the main row.
    const anchor = Math.max(
      -1,
      ...Object.keys(recipe.inputs)
        .filter((input) => !flow.backEdges.has(edgeKey(recipe.id, input)))
        .map((input) => mainSlots.findIndex((main) => main.node === nodeOfItem.get(input))),
    );
    raisedAfter.set(anchor, [...(raisedAfter.get(anchor) ?? []), slot]);
  }

  // Intervals along the bus, per raised row (index 1 is the row nearest the main row): the
  // frames in it, and the spans its frames must avoid because lines pass through there.
  type Span = [number, number];
  const frames: Span[][] = Array.from({ length: raisedRows + 1 }, () => []);
  const blocked: Span[][] = Array.from({ length: raisedRows + 1 }, () => []);
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
    for (let row = 1; row <= raisedRows; row++) {
      if (overlaps(frames[row], frame, slotGap) || overlaps(blocked[row], frame, lineClear))
        continue;
      let below = 1;
      while (below < row && !overlaps(frames[below], lines, lineClear)) below++;
      if (below < row) continue;
      if (row < raisedRows && overlaps(frames[row + 1], exportSpan, lineClear)) continue;
      slot.node.along = along;
      slot.node.across = -nodeOffset - row * raisedStep;
      setTaps(slot);
      frames[row].push(frame);
      for (let lower = 1; lower < row; lower++) blocked[lower].push(lines);
      if (row < raisedRows) blocked[row + 1].push(exportSpan);
      return true;
    }
    return false;
  };

  let cursor = slotGap;
  const pending: Slot[] = [...(raisedAfter.get(-1) ?? [])];
  // Fill the gap ending at `cursor` with every pending raised node that fits, in order, each
  // corridor `slotGap / 2` clear of the one before.
  const fillGap = () => {
    let corridorLeft = cursor - slotGap / 2;
    for (const slot of [...pending]) {
      if (!tryRaise(slot, corridorLeft)) continue;
      pending.splice(pending.indexOf(slot), 1);
      corridorLeft += slot.tapsWidth + slotGap / 2;
      cursor = corridorLeft + slotGap / 2;
    }
  };
  mainSlots.forEach((slot, index) => {
    let left = cursor;
    // An exporting node must not sit under a raised frame, since its export would run into it.
    const exportsHalf = exportsWidthOf(slot.node) / 2;
    if (slot.exports) {
      let moved = true;
      while (moved) {
        const center = left + slot.node.length / 2;
        const clash = frames[1].find(
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
      blocked[1].push([slot.node.along - exportsHalf, slot.node.along + exportsHalf]);
    }
    pending.push(...(raisedAfter.get(index) ?? []));
    fillGap();
  });
  // Past the last main-row node, step along until every remaining raised node fits.
  while (pending.length) {
    fillGap();
    if (pending.length) cursor += tapGap * 2;
  }
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
  interface Interval {
    item: ItemId;
    from: number;
    to: number;
    consumers: Consumer[];
    remainder: number;
  }
  const intervals: Interval[] = [];
  for (const item of itemOrder) {
    const node = nodeOfItem.get(item);
    const laneRate = laneRateOf(item);
    if (!node || laneRate <= 0) continue;
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
    const forward = consumers.filter((consumer) => !consumer.backEdge && consumer.along > from);
    const consumed = forward.reduce((sum, consumer) => sum + consumer.rate, 0);
    const remainder = laneRate - consumed;
    const lastTap = forward.length
      ? forward[forward.length - 1].along + widthFor(forward[forward.length - 1].rate) / 2
      : from;
    const to = remainder > 1e-9 ? Math.max(lastTap, from) + stubLength : lastTap;
    intervals.push({ item, from, to, consumers, remainder });
  }

  // Assign lanes in order of arrival; lane indices count up in creation order.
  //  - "noCrossing": an item may only take an existing lane when every lane nearer the nodes
  //    is vacant where it enters, so a drop never crosses an occupied lane. Of that vacant run
  //    it takes the lane farthest from the nodes, leaving the nearer ones for later items.
  //  - "greedy": the lowest-numbered vacant lane, which uses the fewest lanes but can drop
  //    across lanes that are still in use.
  intervals.sort((a, b) => a.from - b.from);
  const laneFreeAfter: number[] = [];
  const laneOfItem = new Map<ItemId, number>();
  for (const interval of intervals) {
    // A lane is vacant once its previous occupant has ended before this item's drop stroke
    // begins. The previous item's final turn and this item's drop may share a slot, since the
    // turn sits on the leading side and the drop on the trailing side, curving forward; the
    // slot's own tap padding already separates them, so the comparison is inclusive.
    const startEdge = interval.from - widthFor(laneRateOf(interval.item)) / 2;
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

  // Lanes are stacked by their widest occupant. `base` is a lane's far edge; its lines occupy
  // [base - width, base], so narrowing happens on the node side where taps leave.
  const laneMaxWidth = laneFreeAfter.map(() => 0);
  const laneBelts = laneFreeAfter.map(() => 0);
  for (const interval of intervals) {
    const lane = laneOfItem.get(interval.item) ?? 0;
    laneMaxWidth[lane] = Math.max(laneMaxWidth[lane], widthFor(laneRateOf(interval.item)));
    laneBelts[lane] = Math.max(laneBelts[lane], roundUp(laneRateOf(interval.item) / beltPerSecond));
  }
  const laneBase: number[] = [];
  let acrossCursor = 0;
  for (const lane of nearestFirst) {
    acrossCursor += laneMaxWidth[lane];
    laneBase[lane] = acrossCursor;
    acrossCursor += laneGap;
  }

  // Build each item's drawing: the drop from its producer merges into the first lane segment,
  // every tap peels off the near edge with a curve and the lane steps narrower past it, and
  // the last consumer turns the whole remaining lane toward its node.
  const paths: LayoutPath[] = [];
  const laneHeads: LaneHead[] = [];
  for (const interval of intervals) {
    const { item, from, consumers, remainder } = interval;
    const node = nodeOfItem.get(item);
    if (!node) continue;
    const base = laneBase[laneOfItem.get(item) ?? 0];
    let remaining = laneRateOf(item);
    let width = widthFor(remaining);
    let center = base - width / 2;
    let order = 0;
    let fromNode: string | undefined = node.id;
    const headRadius = radiusFor(width);
    laneHeads.push({ item, along: from, across: nodeEdge + beltLabelOffset, rate: remaining });
    let commands: PathCommand[] = [
      { type: "M", point: [from, nodeEdge] },
      { type: "L", point: [from, center - headRadius] },
      corner([from, center - headRadius], [from, center], [from + headRadius, center]),
    ];

    for (const consumer of consumers) {
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
          width: Math.max(widthPerBelt, widthFor(consumer.rate)),
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
      if (after <= 1e-9) {
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
      const tapWidth = widthFor(consumer.rate);
      const afterWidth = widthFor(after);
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

  // Player outputs leave their node on the side away from the bus, spread across its far edge.
  for (const node of nodes) {
    const outputs = node.item ? [node.item] : Object.keys(data.recipes[node.recipe ?? ""].outputs);
    const exported = outputs.filter(
      (output) => outputRateOf(output) > 0 && nodeOfItem.get(output) === node,
    );
    const widths = exported.map((output) => widthFor(outputRateOf(output)));
    const total = widths.reduce((sum, width) => sum + width + tapGap, -tapGap);
    let exportCursor = node.along - total / 2;
    const edge = node.across - frameHalf;
    exported.forEach((output, index) => {
      const along = exportCursor + widths[index] / 2;
      exportCursor += widths[index] + tapGap;
      paths.push({
        id: `export:${output}`,
        item: output,
        kind: "export",
        fromNode: node.id,
        order: -1,
        width: widths[index],
        rate: outputRateOf(output),
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
      belts: laneBelts.reduce((sum, belts) => sum + belts, 0),
    },
  };
}
