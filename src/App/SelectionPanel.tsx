import type { ExtractionCategory, ItemId, ProductionData } from "../data/types.ts";
import type { BuildPreferences } from "../lib/buildPreferences.ts";
import { edgeKey, type Flow } from "../lib/computeFlow.ts";
import { isFluid, pipePerSecond } from "../lib/fluids.ts";
import type { BusLayout } from "../lib/layoutBus.ts";
import {
  extractionCounts,
  extractionOf,
  type MachineCount,
  recipeMachineCounts,
} from "../lib/machineCounts.ts";
import { defaultOutputRate, type OutputState } from "../lib/outputs.ts";
import type { Selection } from "../lib/selection.ts";
import { Tooltip } from "../shared/Tooltip.tsx";
import { categoryColor, mobile, palette } from "../theme/palette.ts";
import { roundUp } from "../util/roundUp.ts";
import { RateField } from "./RateField.tsx";

const extractionHeading: Record<ExtractionCategory, string> = {
  mining: "Drills",
  "fluid-extraction": "Pumpjacks",
  offshore: "Offshore pumps",
};

const formatRate = (rate: number) => (rate >= 10 ? rate.toFixed(1) : rate.toFixed(2));
// Units of fluid one storage tank holds (Factorio wiki, Fluid system).
const storageTankCapacity = 25000;
const formatFillTime = (rate: number) => {
  const minutes = storageTankCapacity / rate / 60;
  return minutes < 120 ? `${Math.round(minutes)} min` : `${(minutes / 60).toFixed(1)} h`;
};
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
    counts.map(({ machine, count, chosen }) => ({
      key: machine.id,
      title: `${machine.name}, speed ${machine.speed}: ${formatExact(count)} exactly`,
      icon: machine.icon,
      value: roundUp(count),
      chosen,
    }));
  // Belts for items, or pumped pipelines for fluids.
  const transportGroup = (item: ItemId, rate: number) => {
    if (!isFluid(data.items[item])) {
      return {
        heading: "Belts",
        tiles: data.belts.map((tier) => ({
          key: tier.id,
          title: `${tier.shortName} belts at ${tier.perSecond}/s each: ${formatExact(rate / tier.perSecond)} exactly`,
          icon: tier.icon,
          value: roundUp(rate / tier.perSecond),
          chosen: tier.id === preferences.belt,
        })),
      };
    }
    return {
      heading: "Pipes",
      tiles: [
        {
          key: "pipes",
          title: `Pumped pipelines at ${pipePerSecond}/s each: ${formatExact(rate / pipePerSecond)} exactly`,
          icon: data.items.pump?.icon,
          value: roundUp(rate / pipePerSecond),
          chosen: true,
        },
      ],
    };
  };

  // Say what the chosen machine holds, or why it holds nothing, when modules are switched on.
  const moduleNote = (counts: MachineCount[]) => {
    const chosen = counts.find((count) => count.chosen);
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
  const nodeRecipe = (nodeId: string) => nodeId.slice("recipe:".length);
  // A cracker only adds to a lane, so its output rate is set on the item's main producer, and
  // fluids are not offered as outputs, as in the Outputs sheet.
  const nodeMakes = (nodeId: string) => {
    const recipe = data.recipes[nodeRecipe(nodeId)];
    const made = nodeId.startsWith("raw:")
      ? [nodeId.slice("raw:".length)]
      : recipe && !recipe.balancing
        ? Object.keys(recipe.outputs)
        : [];
    return made.filter((item) => !isFluid(data.items[item]));
  };

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
      const counts = extractionCounts(data, flow, node.item, preferences);
      const extraction = extractionOf(data.items[node.item]);
      content = {
        item: node.item,
        title: itemName(node.item),
        // Wood and fish are gathered rather than mined, and get no drill counts. Crude oil also
        // names the total field yield it needs, which does not depend on the yield setting:
        // the pumpjacks at the chosen yield add up to that yield times their count.
        headline:
          extraction === "fluid-extraction"
            ? `Pump ${formatRate(rate)}/s; ${Math.round((counts.find((count) => count.chosen)?.count ?? 0) * preferences.pumpjackYield).toLocaleString("en-US")}% total yield`
            : `${extraction === "offshore" ? "Pump" : extraction ? "Mine" : "Supply"} ${formatRate(rate)}/s`,
        tileGroups: [
          {
            heading: extraction ? extractionHeading[extraction] : "Drills",
            tiles: machineTiles(counts),
            note: moduleNote(counts),
          },
          transportGroup(node.item, rate),
        ],
        sections: [],
      };
    } else if (node.recipe) {
      const recipe = data.recipes[node.recipe];
      const machineCounts = recipeMachineCounts(data, flow, recipe.id, preferences);
      // What this recipe itself makes, which for an item with crackers is not the item's total.
      const madeHere = (output: ItemId) => flow.madeRate.get(edgeKey(recipe.id, output)) ?? 0;
      const storedHere = (output: ItemId) => flow.storedRate.get(edgeKey(recipe.id, output)) ?? 0;
      const outputs = Object.keys(recipe.outputs).filter((output) => madeHere(output) > 0);
      content = {
        item: outputs[0] ?? recipe.id,
        title: recipe.name ?? itemName(outputs[0] ?? recipe.id),
        headline: "",
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
          {
            heading: "Outputs",
            rows: outputs.map((output) => ({
              item: output,
              label:
                storedHere(output) > 0
                  ? `${itemName(output)}, ${formatRate(storedHere(output))}/s stored`
                  : itemName(output),
              rate: madeHere(output),
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
    const joins = layout.paths.filter(
      (path) =>
        path.item === selection.item &&
        path.kind === "lane" &&
        path.fromNode &&
        path.order > selection.order,
    );
    const rate = segment?.rate ?? 0;
    content = {
      item: selection.item,
      title: itemName(selection.item),
      headline: `${formatRate(rate)}/s on this stretch`,
      tileGroups: [transportGroup(selection.item, rate)],
      sections: [
        {
          // Crackers that add to the lane further along, so the rates fed below add up.
          heading: "Joined by",
          rows: joins.map((path) => {
            const recipe = data.recipes[path.fromNode?.slice("recipe:".length) ?? ""];
            return {
              item: selection.item,
              label: recipe?.name ?? recipe?.id ?? "",
              rate: path.rate,
            };
          }),
        },
        {
          heading: "Feeds",
          rows: feeds.map((path) => {
            const consumer = nodeItem(path.toNode ?? "");
            return { item: consumer, label: itemName(consumer), rate: path.rate };
          }),
        },
      ],
    };
  } else if (selection.kind === "stored") {
    const rate = flow.storedRate.get(edgeKey(nodeRecipe(selection.node), selection.item)) ?? 0;
    content = {
      item: selection.item,
      title: `${itemName(selection.item)} to store`,
      headline: `${formatRate(rate)}/s left over, stored. Fills a storage tank every ${formatFillTime(rate)}.`,
      tileGroups: [transportGroup(selection.item, rate)],
      sections: [],
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
      // A tap that leaves a node is a feed, which skips the bus; a lane can also end in a node.
      headline:
        tap?.kind === "tap" && tap.fromNode
          ? `${formatRate(rate)}/s, fed straight in rather than from the bus`
          : `${formatRate(rate)}/s`,
      tileGroups: [transportGroup(selection.item, rate)],
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
            // What the + button sets from zero: the category default, not the remembered rate.
            start: defaultOutputRate(data.items[made]),
          }))
      : [];
  // With the output rate in view, the headline only adds something when the node also feeds
  // the bus, and then it says how the total splits so it does not read as a second rate.
  const onChart = selection.kind !== "node" || layout.nodes.some((n) => n.id === selection.node);
  const busRate = (item: ItemId) =>
    (flow.itemRate.get(item) ?? 0) -
    (flow.outputRate.get(item) ?? 0) -
    (flow.surplusRate.get(item) ?? 0);
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
                startValue={row.start}
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
              {group.tiles.map((tile, index) => (
                <Tooltip
                  key={tile.key}
                  label={tile.title}
                  maxWidth={220}
                  align={
                    index === 0 ? "start" : index === group.tiles.length - 1 ? "end" : "center"
                  }
                  css={{ flex: "1 1 0", minWidth: 0 }}
                >
                  <div
                    css={{
                      width: "100%",
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
                </Tooltip>
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
