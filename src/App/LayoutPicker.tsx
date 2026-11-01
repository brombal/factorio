import { useMemo } from "react";
import { type LayoutSettings, layoutChoices } from "../lib/layoutSettings.ts";
import type { LayoutSize } from "../lib/layoutSizes.ts";
import { narrowestLayout } from "../lib/layoutSizes.ts";
import { ChoiceRow } from "../shared/ChoiceRow.tsx";
import { Popover } from "../shared/Popover.tsx";
import { palette } from "../theme/palette.ts";

const choiceNames: { [Key in keyof LayoutSettings]: Record<LayoutSettings[Key], string> } = {
  orientation: { horizontal: "Horizontal", vertical: "Vertical" },
  nodeOrder: { depth: "Crafting depth", outputs: "Output order", lastInput: "After last input" },
  laneReuse: { greedy: "Greedy", noCrossing: "No crossing" },
  outputNodes: { raised: "Raised", inRow: "In row" },
};

const choiceDescriptions: {
  [Key in keyof LayoutSettings]: Record<LayoutSettings[Key], string>;
} = {
  orientation: {
    horizontal: "The bus runs left to right.",
    vertical: "The bus runs top to bottom, which suits a phone held upright.",
  },
  nodeOrder: {
    depth:
      "Orders nodes by crafting steps from raw resources: ores, then plates, then what is made from plates, and so on.",
    outputs:
      "Follows each output's ingredients in output list order, so a chain stays together and a shared item appears where it is first needed.",
    lastInput:
      "Places each item as soon after its last ingredient as it can go, so chains of single steps sit next to each other.",
  },
  laneReuse: {
    noCrossing:
      "A new item takes over a freed lane only when its drop onto that lane does not cross a lane that is still in use.",
    greedy:
      "A new item takes over any freed lane, even when its drop crosses lanes that are still in use. Uses the fewest lanes.",
  },
  outputNodes: {
    raised:
      "Nodes that only make outputs sit in up to three rows above the others, just after their last input, so the bus is shorter.",
    inRow: "Every node sits in one row beside the bus.",
  },
};

const rowLabels: Record<keyof LayoutSettings, string> = {
  orientation: "Bus direction",
  nodeOrder: "Node order",
  laneReuse: "Lane reuse",
  outputNodes: "Output nodes",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// Pipes are only mentioned when the bus has fluid lanes.
const widthText = (size: LayoutSize, beltName = "") =>
  `${plural(size.belts, beltName ? `${beltName} belt` : "belt")}${
    size.pipes ? ` and ${plural(size.pipes, "pipe")}` : ""
  }`;

interface LayoutPickerProps {
  settings: LayoutSettings;
  onChange: (settings: LayoutSettings) => void;
  /** Lays out every node order and lane reuse combination for the current chart. */
  measure: () => LayoutSize[];
  /** The chosen belt tier as players name it, such as "red". */
  beltName: string;
}

/** Header control for how the chart is laid out: bus direction, node order, and lane rules. */
export function LayoutPicker(props: LayoutPickerProps) {
  return (
    <Popover label="Layout" trigger="Layout">
      <LayoutSheet {...props} />
    </Popover>
  );
}

/** The sheet's contents, a separate component so the six layouts are only measured while open. */
function LayoutSheet({ settings, onChange, measure, beltName }: LayoutPickerProps) {
  const sizes = useMemo(() => measure(), [measure]);
  const sizeOf = (nodeOrder: string, laneReuse: string) =>
    sizes.find((size) => size.nodeOrder === nodeOrder && size.laneReuse === laneReuse);
  const current = sizeOf(settings.nodeOrder, settings.laneReuse);
  const best = narrowestLayout(sizes, settings);
  const bestIsCurrent = best === current;

  // Each node order and lane reuse choice shows the width it would give, other settings fixed.
  const detailFor = (key: keyof LayoutSettings, id: string) => {
    const size =
      key === "nodeOrder"
        ? sizeOf(id, settings.laneReuse)
        : key === "laneReuse"
          ? sizeOf(settings.nodeOrder, id)
          : undefined;
    return size && widthText(size);
  };

  const keys = Object.keys(rowLabels) as (keyof LayoutSettings)[];
  return (
    <>
      <div
        css={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div css={{ fontSize: 13 }}>
          <div css={{ fontWeight: 700 }}>
            Bus width: {current ? widthText(current, beltName) : `0 ${beltName} belts`}
          </div>
          <div css={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>
            {current?.lanes ?? 0} lanes
          </div>
        </div>
        <button
          type="button"
          disabled={bestIsCurrent}
          onClick={() =>
            onChange({ ...settings, nodeOrder: best.nodeOrder, laneReuse: best.laneReuse })
          }
          css={{
            minHeight: 34,
            padding: "4px 10px",
            color: palette.text,
            fontSize: 12,
            fontWeight: 600,
            background: palette.node,
            border: `2px solid ${palette.accent}`,
            borderRadius: 0,
            cursor: "pointer",
            "&:disabled": { borderColor: palette.border, color: palette.muted, cursor: "default" },
          }}
        >
          {bestIsCurrent
            ? "Already narrowest"
            : best.belts < (current?.belts ?? 0) ||
                (best.belts === current?.belts && best.pipes < current.pipes)
              ? `Narrowest: ${widthText(best)}`
              : `Same width, ${Math.round((1 - best.length / (current?.length ?? best.length)) * 100)}% shorter`}
        </button>
      </div>
      {keys.map((key) => (
        <ChoiceRow
          key={key}
          label={rowLabels[key]}
          choices={layoutChoices[key].map((id) => ({
            id,
            name: (choiceNames[key] as Record<string, string>)[id],
            description: (choiceDescriptions[key] as Record<string, string>)[id],
            detail: detailFor(key, id),
          }))}
          selected={settings[key]}
          onChoose={(id) => onChange({ ...settings, [key]: id })}
        />
      ))}
    </>
  );
}
