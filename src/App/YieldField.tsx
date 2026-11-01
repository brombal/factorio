import { useEffect, useState } from "react";
import { palette } from "../theme/palette.ts";

interface YieldFieldProps {
  /** Average pumpjack yield as a percentage. */
  value: number;
  onChange: (value: number) => void;
}

/**
 * The average oil field yield the pumpjack counts assume, as a percentage. Only a positive
 * number is passed on; anything else returns to the last good value when the field loses focus.
 */
export function YieldField({ value, onChange }: YieldFieldProps) {
  // Keep the typed text separately, so an in-progress entry such as an empty field is allowed.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  return (
    <div css={{ marginTop: 12 }}>
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
        Pumpjack yield
      </div>
      <div css={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label
          css={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: 34,
            padding: "0 8px",
            border: `2px solid ${palette.border}`,
            "&:focus-within": { borderColor: palette.accent },
          }}
        >
          <input
            type="text"
            inputMode="decimal"
            aria-label="Average pumpjack yield in percent"
            value={text}
            onBlur={() => setText(String(value))}
            onChange={(event) => {
              setText(event.target.value);
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
            }}
            css={{
              width: 56,
              color: palette.text,
              // 16px keeps iOS Safari from zooming the page when the field takes focus.
              fontSize: 16,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
          <span css={{ color: palette.muted, fontSize: 13 }}>%</span>
        </label>
        <span css={{ color: palette.muted, fontSize: 12, lineHeight: 1.4 }}>
          Average per pumpjack, as shown when hovering one in game
        </span>
      </div>
    </div>
  );
}
