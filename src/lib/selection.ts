import type { ItemId } from "../data/types.ts";
import type { BusLayout, LayoutPath } from "./layoutBus.ts";

/**
 * What the user has picked on the chart: a node (raw resource or recipe), a stretch of an
 * item's lane together with everything downstream of it, a single tap into a consumer, or the
 * surplus a node sends to storage.
 */
export type Selection =
  | { kind: "node"; node: string }
  | { kind: "lane"; item: ItemId; order: number }
  | { kind: "tap"; item: ItemId; node: string }
  | { kind: "stored"; item: ItemId; node: string };

const isStoredFrom = (path: LayoutPath, item: ItemId, node: string) =>
  path.stored === true && path.item === item && path.fromNode === node;

/** Whether a selection still points at something on the chart, after the layout changes. */
export function selectionExists(layout: BusLayout, selection: Selection): boolean {
  if (selection.kind === "node") return layout.nodes.some((node) => node.id === selection.node);
  if (selection.kind === "lane")
    return layout.paths.some(
      (path) =>
        path.kind === "lane" && path.item === selection.item && path.order === selection.order,
    );
  if (selection.kind === "stored")
    return layout.paths.some((path) => isStoredFrom(path, selection.item, selection.node));
  return layout.paths.some(
    (path) => path.item === selection.item && path.toNode === selection.node,
  );
}

/** The selection a click on this path makes. */
export function selectionForPath(path: LayoutPath): Selection {
  if (path.kind === "lane") return { kind: "lane", item: path.item, order: path.order };
  if (path.kind === "tap" && path.toNode)
    return { kind: "tap", item: path.item, node: path.toNode };
  if (path.stored && path.fromNode) return { kind: "stored", item: path.item, node: path.fromNode };
  return { kind: "node", node: path.fromNode ?? "" };
}

/**
 * The ids of the paths a selection lights up.
 *
 * - A node lights each input's lane from its producer up to the node's tap, and each output's
 *   lane from where the node drops onto it, with every tap into its consumers, so both ends of
 *   every connection show. Feeds into and out of the node light too, since a feed is a tap
 *   that leaves its producer.
 * - A lane stretch lights itself and every segment and tap after it, but not a cracker's drop
 *   that joins the lane further along, since that flows in rather than downstream.
 * - A tap or feed, or a node's stored surplus, lights only itself.
 */
export function selectedPathIds(paths: LayoutPath[], selection: Selection): Set<string> {
  const ids = new Set<string>();
  const add = (matches: (path: LayoutPath) => boolean) => {
    for (const path of paths) if (matches(path)) ids.add(path.id);
  };

  switch (selection.kind) {
    case "lane":
      add(
        (path) =>
          path.item === selection.item &&
          path.order >= selection.order &&
          !(path.fromNode && path.order > selection.order),
      );
      break;
    case "tap":
      add((path) => path.item === selection.item && path.toNode === selection.node);
      break;
    case "stored":
      add((path) => isStoredFrom(path, selection.item, selection.node));
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
          // Follow the output along its lane from this node's drop to every consumer.
          add((other) => other.item === path.item && other.order >= path.order);
        }
      }
      break;
    }
  }
  return ids;
}
