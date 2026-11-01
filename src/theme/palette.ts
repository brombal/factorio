import type { ItemCategory } from "../data/types.ts";

export const palette = {
  bg: "var(--color-bg)",
  surface: "var(--color-surface)",
  border: "var(--color-border)",
  text: "var(--color-text)",
  muted: "var(--color-muted)",
  accent: "var(--color-accent)",
  node: "var(--color-node)",
  line: "var(--color-line)",
  dim: "var(--color-dim)",
};

export const categoryColor: Record<ItemCategory, string> = {
  raw: "var(--color-cat-raw)",
  intermediate: "var(--color-cat-intermediate)",
  logistics: "var(--color-cat-logistics)",
  production: "var(--color-cat-production)",
  military: "var(--color-cat-military)",
  science: "var(--color-cat-science)",
  fluid: "var(--color-cat-fluid)",
};

export const alpha = (color: string, amount: number) =>
  `color-mix(in oklab, ${color} ${Math.round(amount * 100)}%, transparent)`;

export const mobile = "@media (max-width: 760px)";
