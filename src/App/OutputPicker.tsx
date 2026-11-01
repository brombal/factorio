import { useState } from "react";
import type { Item, ProductionData } from "../data/types.ts";
import { type OutputState, outputCandidates, toggleOutput } from "../lib/outputs.ts";
import { Popover } from "../shared/Popover.tsx";
import { mobile, palette } from "../theme/palette.ts";

const categoryLabel: Record<string, string> = {
  science: "Science",
  intermediate: "Intermediates",
  logistics: "Logistics",
  production: "Production",
  military: "Military",
  raw: "Raw resources",
};

const formatRate = (rate: number) => `${Number(rate.toFixed(2))}/s`;

interface OutputPickerProps {
  data: ProductionData;
  state: OutputState;
  /** Called with the new state and the item that was turned on or off. */
  onChange: (state: OutputState, toggled: Item) => void;
}

/**
 * Header control for what the factory makes. Every item that can be made is an icon toggle;
 * turning one on adds it at its last rate or a default, and the rate is then edited from the
 * chart's details panel.
 */
export function OutputPicker({ data, state, onChange }: OutputPickerProps) {
  // The item under the pointer, or last tapped, and where its button is on screen. The tooltip
  // is drawn with fixed positioning because the scrolling grid would clip one placed inside it.
  const [tip, setTip] = useState<{ item: Item; rect: DOMRect }>();
  const showTip = (item: Item, element: HTMLElement) =>
    setTip({ item, rect: element.getBoundingClientRect() });
  const { outputs } = state;
  const rateOf = new Map(outputs.map((output) => [output.item, output.perSecond]));
  const toggle = (item: Item) => onChange(toggleOutput(data, state, item), item);

  const tipRate = tip && rateOf.get(tip.item.id);
  return (
    <Popover
      label="Outputs"
      width={460}
      trigger={
        <>
          Outputs
          <span css={{ color: palette.text, fontVariantNumeric: "tabular-nums" }}>
            {outputs.length}
          </span>
        </>
      }
    >
      <div css={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: palette.muted }}>
        Tap an item to make it, or tap again to stop. Set rates on the chart.
      </div>
      <div
        css={{
          maxHeight: "min(560px, calc(100dvh - 160px))",
          overflowY: "auto",
          margin: "0 -4px",
          padding: "0 4px",
        }}
        onScroll={() => setTip(undefined)}
      >
        {[...outputCandidates(data)]
          .filter(([, items]) => items.length > 0)
          .map(([category, items]) => (
            <section key={category} css={{ "& + &": { marginTop: 12 } }}>
              <div
                css={{
                  color: palette.muted,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {categoryLabel[category] ?? category}
              </div>
              <div
                css={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(46px, 1fr))",
                  gap: 4,
                  [mobile]: { gridTemplateColumns: "repeat(auto-fill, minmax(50px, 1fr))" },
                }}
              >
                {items.map((item) => {
                  const rate = rateOf.get(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={rate !== undefined}
                      aria-label={item.name}
                      aria-disabled={item.unavailableReason !== undefined}
                      onClick={(event) => {
                        if (!item.unavailableReason) toggle(item);
                        showTip(item, event.currentTarget);
                      }}
                      onPointerEnter={(event) => showTip(item, event.currentTarget)}
                      // A tap ends with the pointer leaving, so only a mouse hides the tip.
                      onPointerLeave={(event) => {
                        if (event.pointerType === "mouse") setTip(undefined);
                      }}
                      onFocus={(event) => showTip(item, event.currentTarget)}
                      onBlur={() => setTip(undefined)}
                      css={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        padding: "5px 0 3px",
                        color: palette.text,
                        background: palette.node,
                        border: `2px solid ${palette.border}`,
                        borderRadius: 0,
                        cursor: "pointer",
                        // Off items keep their color, dimmed, so they are still easy to tell apart.
                        "& img": { opacity: 0.55 },
                        "&[aria-pressed='true']": { borderColor: palette.accent },
                        "&[aria-pressed='true'] img": { opacity: 1, filter: "none" },
                        "&:hover": { borderColor: palette.muted },
                        "&[aria-pressed='true']:hover": { borderColor: palette.accent },
                        // Still focusable and hoverable, so the caption can say why it is off.
                        "&[aria-disabled='true']": {
                          cursor: "default",
                          borderStyle: "dashed",
                          background: "transparent",
                        },
                        "&[aria-disabled='true'] img": { opacity: 0.3, filter: "grayscale(1)" },
                        "&[aria-disabled='true']:hover": { borderColor: palette.border },
                      }}
                    >
                      <img src={item.icon} alt="" width={28} height={28} />
                      <span
                        css={{
                          minHeight: 13,
                          fontSize: 10,
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {rate !== undefined ? formatRate(rate) : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
      {tip && (
        <span
          role="tooltip"
          css={{
            position: "fixed",
            zIndex: 20,
            maxWidth: 220,
            padding: "4px 8px",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.4,
            color: palette.text,
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            transform: "translate(-50%, -100%)",
            pointerEvents: "none",
          }}
          style={{
            // Centered over the button, kept on screen near the edges.
            left: Math.min(
              Math.max(tip.rect.left + tip.rect.width / 2, 118),
              window.innerWidth - 118,
            ),
            top: tip.rect.top - 6,
          }}
        >
          {tip.item.name}
          {tipRate !== undefined && `, ${formatRate(tipRate)}`}
          {tip.item.unavailableReason && (
            <span css={{ display: "block", color: palette.muted, fontWeight: 400 }}>
              {tip.item.unavailableReason}, not available yet
            </span>
          )}
        </span>
      )}
    </Popover>
  );
}
