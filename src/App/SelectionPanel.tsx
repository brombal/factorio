import type { ItemId, ProductionData } from "../data/types.ts";
import { type BuildPreferences, isPreferredMachine } from "../lib/buildPreferences.ts";
import { edgeKey, type Flow } from "../lib/computeFlow.ts";
import { isFluid } from "../lib/fluids.ts";
import type { BusLayout } from "../lib/layoutBus.ts";
import { type MachineCount, miningDrillCounts, recipeMachineCounts } from "../lib/machineCounts.ts";
import { defaultOutputRate, type OutputState } from "../lib/outputs.ts";
import type { Selection } from "../lib/selection.ts";
import { categoryColor, mobile, palette } from "../theme/palette.ts";
import { roundUp } from "../util/roundUp.ts";
import { RateField } from "./RateField.tsx";

const formatRate = (rate: number) => (rate >= 10 ? rate.toFixed(1) : rate.toFixed(2));
const formatExact = (count: number) => count.toFixed(2).replace(/\.?0+$/, "");

interface Row {
  item: ItemId;
  label: string;
  rate: number;
}

interface Tile {
  key: string;
  title: string;
  icon?: string;
  /** Whole machines or belts to build. */
  value: number;
  /** The player's chosen tier, which the chart's own counts use. */
  chosen: boolean;
}

interface PanelContent {
  item: ItemId;
  title: string;
  headline: string;
  tileGroups: { heading: string; tiles: Tile[]; note?: { icon?: string; text: string } }[];
  sections: { heading: string; rows: Row[] }[];
}

interface SelectionPanelProps {
  data: ProductionData;
  flow: Flow;
  layout: BusLayout;
  selection: Selection;
  preferences: BuildPreferences;
  outputState: OutputState;
  /** Sets an item's output rate; zero turns it off, like toggling it in the Outputs sheet. */
  onOutputRateChange: (item: ItemId, perSecond: number) => void;
}

const headingStyle = {
  color: palette.muted,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  marginBottom: 4,
} as const;

/**
 * Details for whatever is selected on the chart, aimed at building it: machine and drill
 * counts, per-second rates for inputs and consumers, and belt counts for flows.
 */
export function SelectionPanel({
  data,
  flow,
  layout,
  selection,
  preferences,
  outputState,
  onOutputRateChange,
}: SelectionPanelProps) {
  const itemName = (item: ItemId) => data.items[item]?.name ?? item;
  const nodeItem = (nodeId: string) => {
    const node = layout.nodes.find((candidate) => candidate.id === nodeId);
    if (node?.item) return node.item;
    return Object.keys(data.recipes[node?.recipe ?? ""]?.outputs ?? {})[0] ?? nodeId;
  };
  const machineTiles = (counts: MachineCount[]): Tile[] =>
    counts.map(({ machine, count }) => ({
      key: machine.id,
      title: `${machine.name}, speed ${machine.speed}: ${formatExact(count)} exactly`,
      icon: machine.icon,
      value: roundUp(count),
      chosen: isPreferredMachine(preferences, machine),
    }));
  const beltTiles = (item: ItemId, rate: number): Tile[] =>
    isFluid(data.items[item])
      ? []
      : data.belts.map((tier) => ({
          key: tier.id,
          title: `${tier.shortName} belts at ${tier.perSecond}/s each: ${formatExact(rate / tier.perSecond)} exactly`,
          icon: tier.icon,
          value: roundUp(rate / tier.perSecond),
          chosen: tier.id === preferences.belt,
        }));

  // Say what the chosen machine holds, or why it holds nothing, when modules are switched on.
  const moduleNote = (counts: MachineCount[]) => {
    const chosen = counts.find(({ machine }) => isPreferredMachine(preferences, machine));
    if (!chosen || preferences.modules === "none") return undefined;
    const { machine, modules } = chosen;
    if (modules.module) {
      const percent = (fraction: number) =>
        `${fraction > 0 ? "+" : ""}${Math.round(fraction * 100)}%`;
      const effects = [
        modules.productivity > 0 && `${percent(modules.productivity)} output`,
        `${percent(modules.speedMultiplier - 1)} speed`,
      ].filter(Boolean);
      return {
        icon: modules.module.icon,
        text: `Each ${machine.name} holds ${modules.count} × ${modules.module.name}, ${effects.join(", ")}`,
      };
    }
    if (machine.moduleSlots === 0) return { text: `${machine.name} has no module slots` };
    return { text: "This recipe does not take productivity modules" };
  };

  // The items a node makes, from its id, so they are known even after it leaves the chart.
  const nodeMakes = (nodeId: string) =>
    nodeId.startsWith("raw:")
      ? [nodeId.slice("raw:".length)]
      : Object.keys(data.recipes[nodeId.slice("recipe:".length)]?.outputs ?? {});

  // Gather the panel's content for each kind of selection.
  let content: PanelContent | undefined;
  if (selection.kind === "node") {
    const node = layout.nodes.find((candidate) => candidate.id === selection.node);
    if (!node) {
      // A pinned node whose output rate went to zero has left the chart. Keep its panel, with
      // only the output rate, so the change is easy to undo.
      const made = nodeMakes(selection.node);
      const recipe = data.recipes[selection.node.slice("recipe:".length)];
      content = {
        item: made[0] ?? selection.node,
        title: recipe?.name ?? itemName(made[0] ?? selection.node),
        headline: "Not on the chart. Raise the output rate to add it back.",
        tileGroups: [],
        sections: [],
      };
    } else if (node.kind === "raw" && node.item) {
      const rate = flow.itemRate.get(node.item) ?? 0;
      const drillCounts = miningDrillCounts(data, flow, node.item, preferences);
      content = {
        item: node.item,
        title: itemName(node.item),
        // Wood and fish are gathered rather than mined, and get no drill counts.
        headline: `${data.items[node.item]?.miningTime ? "Mine" : "Supply"} ${formatRate(rate)}/s`,
        tileGroups: [
          {
            heading: "Drills",
            tiles: machineTiles(drillCounts),
            note: moduleNote(drillCounts),
          },
          { heading: "Belts", tiles: beltTiles(node.item, rate) },
        ],
        sections: [],
      };
    } else if (node.recipe) {
      const recipe = data.recipes[node.recipe];
      const machineCounts = recipeMachineCounts(data, flow, recipe.id, preferences);
      const outputs = Object.keys(recipe.outputs).filter(
        (output) => (flow.itemRate.get(output) ?? 0) > 0,
      );
      content = {
        item: outputs[0] ?? recipe.id,
        title: recipe.name ?? itemName(outputs[0] ?? recipe.id),
        headline: `Make ${outputs
          .map((output) => `${formatRate(flow.itemRate.get(output) ?? 0)}/s ${itemName(output)}`)
          .join(", ")}`,
        tileGroups: [
          {
            heading: "Machines required",
            tiles: machineTiles(machineCounts),
            note: moduleNote(machineCounts),
          },
        ],
        sections: [
          {
            heading: "Inputs",
            rows: Object.keys(recipe.inputs).map((input) => ({
              item: input,
              label: itemName(input),
              rate: flow.edgeRate.get(edgeKey(recipe.id, input)) ?? 0,
            })),
          },
        ],
      };
    }
  } else if (selection.kind === "lane") {
    const segment = layout.paths.find(
      (path) =>
        path.kind === "lane" && path.item === selection.item && path.order === selection.order,
    );
    const feeds = layout.paths
      .filter(
        (path) => path.item === selection.item && path.order >= selection.order && path.toNode,
      )
      .sort((a, b) => a.order - b.order);
    const rate = segment?.rate ?? 0;
    content = {
      item: selection.item,
      title: itemName(selection.item),
      headline: `${formatRate(rate)}/s on this stretch`,
      tileGroups: [{ heading: "Belts", tiles: beltTiles(selection.item, rate) }],
      sections: [
        {
          heading: "Feeds",
          rows: feeds.map((path) => {
            const consumer = nodeItem(path.toNode ?? "");
            return { item: consumer, label: itemName(consumer), rate: path.rate };
          }),
        },
      ],
    };
  } else {
    const tap = layout.paths.find(
      (path) => path.item === selection.item && path.toNode === selection.node,
    );
    const consumer = nodeItem(selection.node);
    const rate = tap?.rate ?? 0;
    content = {
      item: selection.item,
      title: `${itemName(selection.item)} into ${itemName(consumer)}`,
      headline: `${formatRate(rate)}/s`,
      tileGroups: [{ heading: "Belts", tiles: beltTiles(selection.item, rate) }],
      sections: [],
    };
  }
  if (!content) return null;

  // Every node shows an output rate for each item it makes, zero when the item is not an output.
  const rateRows =
    selection.kind === "node"
      ? nodeMakes(selection.node)
          .filter((made) => data.items[made] && !data.items[made].unavailableReason)
          .map((made) => ({
            item: made,
            rate: outputState.outputs.find((output) => output.item === made)?.perSecond ?? 0,
            // What the + button restores from zero, as toggling it on in the Outputs sheet would.
            restore: outputState.lastRates[made] ?? defaultOutputRate(data.items[made]),
          }))
      : [];
  // With the output rate in view, the headline only adds something when the node also feeds
  // the bus, and then it says how the total splits so it does not read as a second rate.
  const onChart = selection.kind !== "node" || layout.nodes.some((n) => n.id === selection.node);
  const busRate = (item: ItemId) =>
    (flow.itemRate.get(item) ?? 0) - (flow.outputRate.get(item) ?? 0);
  const single = rateRows.length === 1 ? rateRows[0] : undefined;
  const headline =
    !onChart || !single || single.rate === 0
      ? content.headline
      : busRate(single.item) > 1e-9
        ? `${formatRate(flow.itemRate.get(single.item) ?? 0)}/s in total, ${formatRate(busRate(single.item))}/s of it for the bus`
        : undefined;

  const item = data.items[content.item];
  const accent = item?.color ?? categoryColor[item?.category ?? "intermediate"];

  return (
    <div
      css={{
        position: "absolute",
        left: 12,
        bottom: "max(12px, env(safe-area-inset-bottom))",
        width: 340,
        padding: "12px 14px 14px",
        background: palette.surface,
        border: `2px solid ${palette.border}`,
        borderTop: `4px solid ${accent}`,
        [mobile]: { width: "auto", right: 12 },
      }}
    >
      <div css={{ display: "flex", alignItems: "center", gap: 10 }}>
        {item?.icon && <img src={item.icon} alt="" width={28} height={28} />}
        <div css={{ fontWeight: 700, fontSize: 15 }}>{content.title}</div>
      </div>
      {headline && <div css={{ color: palette.muted, fontSize: 13, marginTop: 4 }}>{headline}</div>}

      {rateRows.length > 0 && (
        <div css={{ marginTop: 12 }}>
          <div css={headingStyle}>Output rate</div>
          {rateRows.map((row) => (
            <div
              key={row.item}
              css={{ display: "flex", alignItems: "center", gap: 8, "& + &": { marginTop: 6 } }}
            >
              <RateField
                value={row.rate}
                restoreValue={row.restore}
                onChange={(rate) => onOutputRateChange(row.item, rate)}
              />
              {rateRows.length > 1 && <span css={{ fontSize: 13 }}>{itemName(row.item)}</span>}
            </div>
          ))}
        </div>
      )}

      {content.tileGroups
        .filter((group) => group.tiles.length > 0)
        .map((group) => (
          <div key={group.heading} css={{ marginTop: 12 }}>
            <div css={headingStyle}>{group.heading}</div>
            <div css={{ display: "flex", gap: 6 }}>
              {group.tiles.map((tile) => (
                <div
                  key={tile.key}
                  title={tile.title}
                  css={{
                    flex: "1 1 0",
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    border: `1px solid ${tile.chosen ? palette.accent : palette.border}`,
                    fontWeight: tile.chosen ? 700 : 400,
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {tile.icon && <img src={tile.icon} alt="" width={20} height={20} />}
                  {tile.value}
                </div>
              ))}
            </div>
            {group.note && (
              <div
                css={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 6,
                  color: palette.muted,
                  fontSize: 12,
                }}
              >
                {group.note.icon && <img src={group.note.icon} alt="" width={16} height={16} />}
                {group.note.text}
              </div>
            )}
          </div>
        ))}

      {content.sections
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <div key={section.heading} css={{ marginTop: 12 }}>
            <div css={headingStyle}>{section.heading}</div>
            {section.rows.map((row) => (
              <div
                key={`${section.heading}:${row.item}`}
                css={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "3px 0",
                  fontSize: 13,
                }}
              >
                {data.items[row.item]?.icon && (
                  <img src={data.items[row.item]?.icon} alt="" width={18} height={18} />
                )}
                <span css={{ flex: 1 }}>{row.label}</span>
                <span css={{ fontVariantNumeric: "tabular-nums" }}>{formatRate(row.rate)}/s</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
