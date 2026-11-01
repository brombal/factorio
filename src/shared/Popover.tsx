import { type ReactNode, useState } from "react";
import { mobile, palette } from "../theme/palette.ts";
import { Tooltip } from "./Tooltip.tsx";

interface PopoverProps {
  /** Names the trigger for its tooltip and screen readers, and titles the sheet. */
  label: string;
  /** What the trigger button shows. */
  trigger: ReactNode;
  /** Sheet width on wider screens; on a phone the sheet spans the screen. */
  width?: number;
  children: ReactNode;
}

/**
 * A header button that opens a sheet below the header. Tapping anywhere outside the sheet
 * closes it. The sheet anchors to the nearest positioned ancestor, which is the header.
 */
export function Popover({ label, trigger, width = 320, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip label={label} placement="bottom" align="end">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          css={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minHeight: 30,
            padding: "3px 8px",
            color: palette.muted,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: "uppercase",
            background: "transparent",
            border: `1px solid ${palette.border}`,
            borderRadius: 0,
            cursor: "pointer",
            "&:hover, &[aria-expanded='true']": { borderColor: palette.muted, color: palette.text },
          }}
        >
          {trigger}
        </button>
      </Tooltip>

      {open && (
        <>
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            css={{ position: "fixed", inset: 0, zIndex: 10 }}
          />
          <div
            role="dialog"
            aria-label={label}
            css={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 16,
              zIndex: 11,
              width,
              // Scroll a sheet taller than the screen below the header, padding included, so
              // the first row's tooltips have room above them.
              boxSizing: "border-box",
              maxHeight: "calc(100dvh - 68px)",
              overflowY: "auto",
              padding: "16px 14px 12px",
              background: palette.surface,
              border: `2px solid ${palette.border}`,
              [mobile]: { left: 12, right: 12, width: "auto" },
            }}
          >
            {children}
          </div>
        </>
      )}
    </>
  );
}
