import { useEffect, useRef, useState } from "react";
import { palette } from "../theme/palette.ts";

// Small rates need fine steps and large ones coarse steps, so the step grows with the rate.
const stepAbove = (rate: number) => (rate < 1 ? 0.05 : rate < 5 ? 0.5 : 1);
const round = (rate: number) => Math.round(rate * 100) / 100;
const display = (rate: number) => String(round(rate));

interface RateFieldProps {
  value: number;
  /** What the + button sets when the value is zero, instead of the smallest step. */
  restoreValue?: number;
  onChange: (value: number) => void;
}

/**
 * An items-per-second input with step buttons, down to zero. A typed zero is only passed on
 * when the field loses focus, so typing "0.5" does not pass through zero on the way.
 */
export function RateField({ value, restoreValue, onChange }: RateFieldProps) {
  // Keep the typed text separately, so an in-progress entry such as "0." is not rewritten.
  const [text, setText] = useState(display(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(display(value));
  }, [value]);

  const down = Math.max(0, round(value - stepAbove(value - 1e-9)));
  const up = value <= 0 && restoreValue ? restoreValue : round(value + stepAbove(value));
  const buttonStyle = {
    width: 36,
    color: palette.text,
    fontSize: 16,
    fontWeight: 700,
    background: palette.node,
    border: `2px solid ${palette.border}`,
    borderRadius: 0,
    cursor: "pointer",
    "&:hover:not(:disabled)": { borderColor: palette.muted },
    "&:disabled": { opacity: 0.4, cursor: "default" },
  } as const;

  return (
    <div css={{ display: "flex", alignItems: "stretch", gap: 4, height: 34 }}>
      <button
        type="button"
        aria-label="Decrease rate"
        disabled={value <= 0}
        onClick={() => onChange(down)}
        css={buttonStyle}
      >
        -
      </button>
      <label
        css={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 8px",
          border: `2px solid ${palette.border}`,
          "&:focus-within": { borderColor: palette.accent },
        }}
      >
        <input
          type="text"
          inputMode="decimal"
          aria-label="Items per second"
          value={text}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            const typedZero = text.trim() !== "" && Number(text) === 0;
            if (typedZero && value > 0) onChange(0);
            setText(display(typedZero ? 0 : value));
          }}
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
        <span css={{ color: palette.muted, fontSize: 13 }}>/s</span>
      </label>
      <button
        type="button"
        aria-label="Increase rate"
        onClick={() => onChange(up)}
        css={buttonStyle}
      >
        +
      </button>
    </div>
  );
}
