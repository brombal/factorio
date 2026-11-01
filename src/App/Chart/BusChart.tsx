import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductionData } from "../../data/types.ts";
import type { BuildPreferences } from "../../lib/buildPreferences.ts";
import type { Flow } from "../../lib/computeFlow.ts";
import { isFluid, pipePerSecond } from "../../lib/fluids.ts";
import type { BusLayout, LayoutPath, PathCommand, Pt } from "../../lib/layoutBus.ts";
import { defaultLayoutOptions } from "../../lib/layoutBus.ts";
import type { Orientation } from "../../lib/layoutSettings.ts";
import { extractionCounts, recipeMachineCounts } from "../../lib/machineCounts.ts";
import { type Selection, selectedPathIds, selectionForPath } from "../../lib/selection.ts";
import { categoryColor, palette } from "../../theme/palette.ts";
import { roundUp } from "../../util/roundUp.ts";

interface BusChartProps {
  data: ProductionData;
  flow: Flow;
  layout: BusLayout;
  preferences: BuildPreferences;
  orientation: Orientation;
  /** What to light up: the node under the mouse, else the pinned selection. */
  selection?: Selection;
  onSelect: (selection: Selection | undefined) => void;
  /** Called with a node id while the mouse is over it, and undefined when it leaves. */
  onHoverNode: (node: string | undefined) => void;
  /** Refits the view to the whole chart whenever this changes. */
  fitKey: string;
}

const padding = 40;
const { iconSize, framePad } = defaultLayoutOptions;
const frameHalf = iconSize / 2 + framePad;
const badgeHeight = 14;
const labelHeight = 13;
// Rough advance width of one character in the 10px bold label font, for sizing label boxes.
const charWidth = 6.2;
// Wall thickness of a fluid line drawn as a hollow pipe.
const pipeWall = 1.5;
// Loop taps and surplus to store are dashed: neither is part of the forward flow. Other fluid
// lines are drawn as pipes, a darker channel inside walls of the line's color.
const isDashed = (path: LayoutPath) => path.backEdge || path.stored === true;

/**
 * Draws a bus layout as SVG and lets the user pan and zoom it. The layout's abstract axes are
 * mapped to screen axes here, so the same layout renders as a horizontal or a vertical bus.
 */
export function BusChart({
  data,
  flow,
  layout,
  preferences,
  orientation,
  selection,
  onSelect,
  onHoverNode,
  fitKey,
}: BusChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);

  const point = (pt: Pt) => (orientation === "horizontal" ? pt : ([pt[1], pt[0]] as Pt));
  const toPathData = (commands: PathCommand[]) =>
    commands
      .map((command) => {
        const [x, y] = point(command.point);
        if (command.type === "C") {
          const [c1x, c1y] = point(command.control1);
          const [c2x, c2y] = point(command.control2);
          return `C${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`;
        }
        return `${command.type}${x} ${y}`;
      })
      .join("");

  const { bounds } = layout;
  const [minX, minY] = point([bounds.alongMin, bounds.acrossMin]);
  const [maxX, maxY] = point([bounds.alongMax, bounds.acrossMax]);
  const contentWidth = Math.abs(maxX - minX);
  const contentHeight = Math.abs(maxY - minY);
  const contentX = Math.min(minX, maxX);
  const contentY = Math.min(minY, maxY);

  // Attach d3-zoom once; the behavior is kept so a later fit can move the view.
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(undefined);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 8])
      .filter((event) => !event.button)
      .on("zoom", (event) => setTransform(event.transform));
    select(svg).call(behavior);
    zoomRef.current = behavior;
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  // Fit the whole chart into view when `fitKey` changes, not on every re-layout, so editing a
  // rate does not throw away the player's pan and zoom.
  const content = { contentWidth, contentHeight, contentX, contentY };
  const contentRef = useRef(content);
  contentRef.current = content;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refitting is keyed on fitKey alone.
  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    // Fit once the svg has a real size; a hidden or still-laying-out pane reports zero.
    const fit = () => {
      const { contentWidth, contentHeight, contentX, contentY } = contentRef.current;
      const { width, height } = svg.getBoundingClientRect();
      if (width < padding * 2 || height < padding * 2) return false;
      const scale = Math.min(
        (width - padding * 2) / contentWidth,
        (height - padding * 2) / contentHeight,
        2,
      );
      const fitted = zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-(contentX + contentWidth / 2), -(contentY + contentHeight / 2));
      select(svg).call(behavior.transform, fitted);
      return true;
    };
    let observer: ResizeObserver | undefined;
    if (!fit()) {
      observer = new ResizeObserver(() => {
        if (fit()) observer?.disconnect();
      });
      observer.observe(svg);
    }
    return () => observer?.disconnect();
  }, [fitKey]);

  const itemColor = (item: string) =>
    data.items[item]?.color ?? categoryColor[data.items[item]?.category ?? "intermediate"];

  const nodeItems = useMemo(
    () =>
      layout.nodes.map((node) => {
        const itemId =
          node.kind === "raw"
            ? node.item
            : Object.keys(data.recipes[node.recipe ?? ""]?.outputs ?? {})[0];
        return { node, item: itemId ? data.items[itemId] : undefined };
      }),
    [layout, data],
  );

  // Draw unselected paths first so the selection sits on top where lines cross, and light
  // every node that a selected path leaves from or enters.
  const { orderedPaths, litPaths, litNodes } = useMemo(() => {
    if (!selection) {
      return { orderedPaths: layout.paths, litPaths: undefined, litNodes: undefined };
    }
    const litIds = selectedPathIds(layout.paths, selection);
    const lit = layout.paths.filter((path) => litIds.has(path.id));
    const nodes = new Set<string>(selection.kind === "node" ? [selection.node] : []);
    for (const path of lit) {
      if (path.fromNode) nodes.add(path.fromNode);
      if (path.toNode) nodes.add(path.toNode);
    }
    return {
      orderedPaths: [...layout.paths.filter((path) => !litIds.has(path.id)), ...lit],
      litPaths: litIds,
      litNodes: nodes,
    };
  }, [layout, selection]);

  const strokes = useMemo(() => {
    const isHollow = (path: LayoutPath) =>
      !isDashed(path) && isFluid(data.items[path.item]) && path.width >= pipeWall * 2 + 1;
    // Draw all of an item's walls before any of its channels, so pieces of one pipe that
    // overlap at forks, drops, and corners merge instead of walling across each other. Lit
    // paths still go above unlit ones.
    const result: { path: LayoutPath; inner: boolean }[] = [];
    const lit = (path: LayoutPath) => !litPaths || litPaths.has(path.id);
    for (const layer of [orderedPaths.filter((path) => !lit(path)), orderedPaths.filter(lit)]) {
      const items = [...new Set(layer.map((path) => path.item))];
      for (const item of items) {
        const paths = layer.filter((path) => path.item === item);
        result.push(...paths.map((path) => ({ path, inner: false })));
        result.push(...paths.filter(isHollow).map((path) => ({ path, inner: true })));
      }
    }
    return result;
  }, [orderedPaths, litPaths, data]);

  // Count of the chosen machine for each node, rounded up to whole machines to build.
  const machineBadges = useMemo(() => {
    const badges = new Map<string, number>();
    for (const node of layout.nodes) {
      const counts =
        node.kind === "raw" && node.item
          ? extractionCounts(data, flow, node.item, preferences)
          : node.recipe
            ? recipeMachineCounts(data, flow, node.recipe, preferences)
            : [];
      const picked = counts.find((count) => count.chosen);
      if (picked) badges.set(node.id, roundUp(picked.count));
    }
    return badges;
  }, [layout, data, flow, preferences]);

  const belt = data.belts.find((tier) => tier.id === preferences.belt);

  return (
    <svg
      ref={svgRef}
      css={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none",
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
      }}
      onClick={() => onSelect(undefined)}
      role="img"
      aria-label="Production bus chart"
    >
      <g transform={transform.toString()}>
        {strokes.map(({ path, inner }) => {
          const stroke =
            litPaths && !litPaths.has(path.id)
              ? palette.dim
              : path.stored
                ? palette.muted
                : itemColor(path.item);
          return inner ? (
            <path
              key={`${path.id}:inner`}
              d={toPathData(path.commands)}
              fill="none"
              stroke={`color-mix(in oklch, ${stroke} 30%, ${palette.bg})`}
              strokeWidth={path.width - pipeWall * 2}
              strokeLinecap="butt"
              strokeLinejoin="miter"
              pointerEvents="none"
            />
          ) : (
            <path
              key={path.id}
              d={toPathData(path.commands)}
              fill="none"
              stroke={stroke}
              strokeWidth={path.width}
              strokeLinecap="butt"
              strokeLinejoin="miter"
              strokeDasharray={isDashed(path) ? "4 4" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(selectionForPath(path));
              }}
            >
              <title>{`${data.items[path.item]?.name}: ${path.rate.toFixed(2)}/s`}</title>
            </path>
          );
        })}

        {belt &&
          layout.laneHeads.map((head) => {
            const fluid = isFluid(data.items[head.item]);
            const carriers = head.rate / (fluid ? pipePerSecond : belt.perSecond);
            // A count only shows when a line needs more than one belt or pipe; one is the norm.
            if (carriers <= 1 + 1e-9) return null;
            const text = String(roundUp(carriers));
            const width = 8 + text.length * charWidth;
            const [x, y] = point([head.along, head.across]);
            const dim = litPaths && !litPaths.has(head.pathId);
            const color = dim ? palette.dim : fluid ? palette.muted : belt.color;
            return (
              <g
                key={`belts:${head.pathId}`}
                transform={`translate(${x}, ${y})`}
                pointerEvents="none"
              >
                <title>
                  {fluid ? `${text} pumped pipes` : `${text} ${belt.shortName.toLowerCase()} belts`}
                </title>
                <rect
                  x={-width / 2}
                  y={-labelHeight / 2}
                  width={width}
                  height={labelHeight}
                  fill={color}
                  stroke={color}
                  strokeWidth={1.5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  fontWeight={700}
                  fill={palette.bg}
                  css={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {text}
                </text>
              </g>
            );
          })}

        {nodeItems.map(({ node, item }) => {
          const [cx, cy] = point([node.along, node.across]);
          const isSelected = selection?.kind === "node" && selection.node === node.id;
          const color = item ? itemColor(item.id) : palette.line;
          const frameColor = !litNodes || litNodes.has(node.id) ? color : palette.dim;
          const badge = machineBadges.get(node.id);
          const badgeWidth = 8 + String(badge ?? "").length * charWidth;
          // The trailing corner on the side away from the bus, wherever that lands on screen.
          const [badgeX, badgeY] = point([node.length / 2, -frameHalf]);
          const [frameWidth, frameHeight] = point([node.length, frameHalf * 2]);
          return (
            <g
              key={node.id}
              transform={`translate(${cx}, ${cy})`}
              css={{ cursor: "pointer" }}
              onClick={(event) => {
                event.stopPropagation();
                onSelect({ kind: "node", node: node.id });
              }}
              // Mouse only: a tap on a phone also fires these, and should just pin the node.
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHoverNode(node.id);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") onHoverNode(undefined);
              }}
            >
              <title>{item?.name}</title>
              <rect
                x={-frameWidth / 2}
                y={-frameHeight / 2}
                width={frameWidth}
                height={frameHeight}
                fill={palette.node}
                stroke={frameColor}
                strokeWidth={isSelected ? 3.5 : 2}
              />
              {item?.icon && (
                <image
                  href={item.icon}
                  x={-iconSize / 2}
                  y={-iconSize / 2}
                  width={iconSize}
                  height={iconSize}
                  style={{ pointerEvents: "none" }}
                />
              )}
              {badge !== undefined && (
                <g transform={`translate(${badgeX}, ${badgeY})`} pointerEvents="none">
                  <rect
                    x={-badgeWidth / 2}
                    y={-badgeHeight / 2}
                    width={badgeWidth}
                    height={badgeHeight}
                    fill={frameColor}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={10}
                    fontWeight={800}
                    fill={palette.bg}
                    css={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {badge}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
