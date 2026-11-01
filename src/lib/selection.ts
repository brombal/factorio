import type { ItemId } from "../data/types.ts";
import type { BusLayout, LayoutPath } from "./layoutBus.ts";

/**
 * What the user has picked on the chart: a node (raw resource or recipe), a stretch of an
 * item's lane together with everything downstream of it, or a single tap into a consumer.
 */
export type Selection =
  | { kind: "node"; node: string }
  | { kind: "lane"; item: ItemId; order: number }
  | { kind: "tap"; item: ItemId; node: string };

/** Whether a selection still points at something on the chart, after the layout changes. */
export function selectionExists(layout: BusLayout, selection: Selection): boolean {
  if (selection.kind === "node") return layout.nodes.some((node) => node.id === selection.node);
  if (selection.kind === "lane")
    return layout.paths.some(
      (path) =>
        path.kind === "lane" && path.item === selection.item && path.order === selection.order,
    );
  return layout.paths.some(
    (path) => path.item === selection.item && path.toNode === selection.node,
  );
}

/** The selection a click on this path makes. */
export function selectionForPath(path: LayoutPath): Selection {
  if (path.kind === "lane") return { kind: "lane", item: path.item, order: path.order };
  if (path.kind === "tap" && path.toNode)
    return { kind: "tap", item: path.item, node: path.toNode };
  return { kind: "node", node: path.fromNode ?? "" };
}

/**
 * The ids of the paths a selection lights up.
 *
 * - A node lights each input's lane from its producer up to the node's tap, and each output's
 *   whole lane with every tap into its consumers, so both ends of every connection show.
 * - A lane stretch lights itself and every segment and tap after it.
 * - A tap lights only itself.
 */
export function selectedPathIds(paths: LayoutPath[], selection: Selection): Set<string> {
  const ids = new Set<string>();
  const add = (matches: (path: LayoutPath) => boolean) => {
    for (const path of paths) if (matches(path)) ids.add(path.id);
  };

  switch (selection.kind) {
    case "lane":
      add((path) => path.item === selection.item && path.order >= selection.order);
      break;
    case "tap":
      add((path) => path.item === selection.item && path.toNode === selection.node);
      break;
    case "node": {
      const node = selection.node;
      add((path) => path.fromNode === node || path.toNode === node);
      for (const path of paths) {
        if (path.toNode === node && path.order >= 0) {
          // Trace the input back along its lane to the producer. Taps that leave earlier go to
          // other consumers, so only the lane segments are lit.
          add(
            (other) =>
              other.item === path.item && other.kind === "lane" && other.order <= path.order,
          );
        } else if (path.fromNode === node && path.kind === "lane") {
          // Follow the output along its whole lane to every consumer.
          add((other) => other.item === path.item && other.order >= 0);
        }
      }
      break;
    }
  }
  return ids;
}
