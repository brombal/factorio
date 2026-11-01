import type { LaneReuse, OutputNodes } from "./layoutBus.ts";
import type { NodeOrder } from "./nodeOrder.ts";

export type Orientation = "horizontal" | "vertical";

/** How the chart is laid out, as chosen in the Layout sheet. */
export interface LayoutSettings {
  orientation: Orientation;
  nodeOrder: NodeOrder;
  laneReuse: LaneReuse;
  outputNodes: OutputNodes;
}

/** Every choice per setting, in the order the Layout sheet shows them, default first. */
export const layoutChoices = {
  orientation: ["horizontal", "vertical"],
  nodeOrder: ["depth", "outputs", "lastInput"],
  laneReuse: ["greedy", "noCrossing"],
  outputNodes: ["raised", "inRow"],
} as const satisfies { [Key in keyof LayoutSettings]: readonly LayoutSettings[Key][] };

const storageKey = "factorio-bus:layout-settings";

/**
 * Reads saved settings, keeping only values that are still valid. Without a saved direction,
 * the bus runs along the screen's longer side.
 */
export function loadLayoutSettings(): LayoutSettings {
  let saved: Partial<Record<keyof LayoutSettings, string>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    // Storage can be unavailable or hold garbage; defaults are fine either way.
  }
  const pick = <Key extends keyof LayoutSettings>(key: Key, fallback: LayoutSettings[Key]) =>
    ((layoutChoices[key] as readonly string[]).includes(saved[key] ?? "")
      ? saved[key]
      : fallback) as LayoutSettings[Key];
  return {
    orientation: pick(
      "orientation",
      window.innerHeight > window.innerWidth ? "vertical" : "horizontal",
    ),
    nodeOrder: pick("nodeOrder", "depth"),
    laneReuse: pick("laneReuse", "greedy"),
    outputNodes: pick("outputNodes", "raised"),
  };
}

export function saveLayoutSettings(settings: LayoutSettings) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // Not persisting is acceptable; the choice still applies for this visit.
  }
}
