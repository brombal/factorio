import type { ReactNode } from "react";
import { palette } from "../theme/palette.ts";

const alignStyles = {
  start: { left: 0 },
  center: { left: "50%", transform: "translateX(-50%)" },
  end: { right: 0 },
};

interface TooltipProps {
  label: string;
  /** Which side of the wrapped element the label appears on. */
  placement?: "top" | "bottom";
  /** Which edge of the wrapped element the label lines up with; use an outer edge near the screen edge. */
  align?: "start" | "center" | "end";
  /** Lets a longer label wrap onto several lines, up to this width in pixels. */
  maxWidth?: number;
  children: ReactNode;
  /** Receives styles from a `css` prop at the call site, which Emotion turns into a class. */
  className?: string;
}

/**
 * Wraps an element and shows a short label beside it on hover or keyboard focus. Unlike the
 * native `title` attribute this also shows on iOS, where tapping a control applies its hover
 * state.
 */
export function Tooltip({
  label,
  placement = "top",
  align = "center",
  maxWidth,
  children,
  className,
}: TooltipProps) {
  return (
    <span
      className={className}
      css={{
        position: "relative",
        display: "inline-flex",
        // Keyboard focus only, so a clicked button does not keep its label after the pointer leaves.
        "&:hover .Tooltip-label, &:has(:focus-visible) .Tooltip-label": { opacity: 1 },
        // A control that has opened its own panel does not need its label on top of it.
        "&:has([aria-expanded='true']) .Tooltip-label": { display: "none" },
      }}
    >
      {children}
      <span
        className="Tooltip-label"
        role="tooltip"
        css={{
          position: "absolute",
          ...alignStyles[align],
          ...(placement === "top" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
          zIndex: 20,
          padding: "4px 8px",
          ...(maxWidth
            ? { width: "max-content", maxWidth, whiteSpace: "normal", lineHeight: 1.4 }
            : { whiteSpace: "nowrap" }),
          fontSize: 12,
          fontWeight: 600,
          color: palette.text,
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 120ms",
        }}
      >
        {label}
      </span>
    </span>
  );
}
