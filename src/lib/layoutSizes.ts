import type { ProductionData } from "../data/types.ts";
import type { Flow } from "./computeFlow.ts";
import { type LaneReuse, type LayoutOptions, layoutBus } from "./layoutBus.ts";
import { layoutChoices } from "./layoutSettings.ts";
import type { NodeOrder } from "./nodeOrder.ts";

/** One node order and lane reuse combination and the bus it produces. */
export interface LayoutSize {
  nodeOrder: NodeOrder;
  laneReuse: LaneReuse;
  belts: number;
  pipes: number;
  lanes: number;
  /** Chart length, used only to break ties; it has no in-game meaning. */
  length: number;
}

/**
 * Lays out every node order and lane reuse combination with the other options as given, and
 * reports each one's bus width.
 */
export function layoutSizes(
  data: ProductionData,
  flow: Flow,
  beltPerSecond: number,
  options: LayoutOptions,
): LayoutSize[] {
  return layoutChoices.nodeOrder.flatMap((nodeOrder) =>
    layoutChoices.laneReuse.map((laneReuse) => {
      const layout = layoutBus(data, flow, beltPerSecond, { ...options, nodeOrder, laneReuse });
      return {
        nodeOrder,
        laneReuse,
        belts: layout.busWidth.belts,
        pipes: layout.busWidth.pipes,
        lanes: layout.busWidth.lanes,
        length: layout.bounds.alongMax,
      };
    }),
  );
}

/**
 * The narrowest combination: fewest belts, then fewest pipes, then shortest, then the current
 * one, so a full tie
 * never changes the layout for nothing.
 */
export function narrowestLayout(
  sizes: LayoutSize[],
  current: { nodeOrder: NodeOrder; laneReuse: LaneReuse },
): LayoutSize {
  const isCurrent = (size: LayoutSize) =>
    size.nodeOrder === current.nodeOrder && size.laneReuse === current.laneReuse;
  return [...sizes].sort(
    (a, b) =>
      a.belts - b.belts ||
      a.pipes - b.pipes ||
      a.length - b.length ||
      Number(isCurrent(b)) - Number(isCurrent(a)),
  )[0];
}
