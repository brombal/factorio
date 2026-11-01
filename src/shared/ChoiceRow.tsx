import type { ReactNode } from "react";
import { palette } from "../theme/palette.ts";
import { Tooltip } from "./Tooltip.tsx";

export interface Choice {
  id: string;
  name: string;
  /** Shown instead of the name, such as an icon; the name then becomes its tooltip. */
  content?: ReactNode;
  /** Explains what the choice does, shown as its tooltip. */
  description?: string;
  /** A short figure shown under a text choice's name, such as what it would cost. */
  detail?: string;
}

interface ChoiceRowProps {
  label: string;
  choices: Choice[];
  selected: string | undefined;
  onChoose: (id: string) => void;
  /** Greys the row out and blocks changes, with a short reason under the heading. */
  disabledReason?: string;
}

/** A labelled row of mutually exclusive choices, used inside header sheets. */
export function ChoiceRow({ label, choices, selected, onChoose, disabledReason }: ChoiceRowProps) {
  return (
    <div css={{ "& + &": { marginTop: 12 } }}>
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
        {label}
        {disabledReason && (
          <span css={{ marginLeft: 8, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
            {disabledReason}
          </span>
        )}
      </div>
      <div css={{ display: "flex", gap: 6 }}>
        {choices.map((choice, index) => {
          const button = (
            <button
              key={choice.id}
              type="button"
              aria-pressed={choice.id === selected}
              aria-label={choice.content ? choice.name : undefined}
              disabled={disabledReason !== undefined}
              onClick={() => onChoose(choice.id)}
              css={{
                width: "100%",
                minHeight: 42,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 6,
                color: palette.text,
                fontSize: 12,
                fontWeight: 600,
                background: palette.node,
                border: `2px solid ${palette.border}`,
                borderRadius: 0,
                cursor: "pointer",
                "&[aria-pressed='true']": { borderColor: palette.accent },
                "&:hover:not(:disabled)": { borderColor: palette.muted },
                "&[aria-pressed='true']:hover": { borderColor: palette.accent },
                "&:disabled": { opacity: 0.4, cursor: "default" },
              }}
            >
              {choice.content ?? (
                <span css={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {choice.name}
                  {choice.detail && (
                    <span css={{ color: palette.muted, fontSize: 11, fontWeight: 400 }}>
                      {choice.detail}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
          const align = index === 0 ? "start" : index === choices.length - 1 ? "end" : "center";
          // Text choices already show their name, so they only get a tooltip with a description.
          const tooltip = choice.description ?? (choice.content ? choice.name : undefined);
          return tooltip ? (
            <Tooltip
              key={choice.id}
              label={tooltip}
              align={align}
              maxWidth={choice.description ? 220 : undefined}
              css={{ flex: 1 }}
            >
              {button}
            </Tooltip>
          ) : (
            <span key={choice.id} css={{ flex: 1, display: "flex" }}>
              {button}
            </span>
          );
        })}
      </div>
    </div>
  );
}
