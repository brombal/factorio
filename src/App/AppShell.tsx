import { useCallback, useMemo, useState } from "react";
import type { Item, ItemId } from "../data/types.ts";
import { vanillaData } from "../data/vanillaData.ts";
import {
  type BuildPreferences,
  loadBuildPreferences,
  saveBuildPreferences,
} from "../lib/buildPreferences.ts";
import { computeFlow } from "../lib/computeFlow.ts";
import { defaultLayoutOptions, layoutBus } from "../lib/layoutBus.ts";
import {
  type LayoutSettings,
  loadLayoutSettings,
  saveLayoutSettings,
} from "../lib/layoutSettings.ts";
import { layoutSizes } from "../lib/layoutSizes.ts";
import { recipeProductivity } from "../lib/moduleEffects.ts";
import { loadOutputs, type OutputState, saveOutputs, setOutputRate } from "../lib/outputs.ts";
import { type Selection, selectionExists } from "../lib/selection.ts";
import { mobile, palette } from "../theme/palette.ts";
import { BuildPicker } from "./BuildPicker.tsx";
import { BusChart } from "./Chart/BusChart.tsx";
import { LayoutPicker } from "./LayoutPicker.tsx";
import { OutputPicker } from "./OutputPicker.tsx";
import { SelectionPanel } from "./SelectionPanel.tsx";

export function AppShell() {
  const [layoutSettings, setLayoutSettings] = useState(loadLayoutSettings);
  const changeLayoutSettings = (next: LayoutSettings) => {
    setLayoutSettings(next);
    saveLayoutSettings(next);
  };
  const [selection, setSelection] = useState<Selection>();
  const data = vanillaData;
  const [preferences, setPreferences] = useState(() => loadBuildPreferences(data));
  const changePreferences = (next: BuildPreferences) => {
    setPreferences(next);
    saveBuildPreferences(next);
  };

  const productivity = useMemo(() => recipeProductivity(data, preferences), [preferences]);
  const [outputState, setOutputState] = useState(() => loadOutputs(data));
  const { outputs } = outputState;
  const changeOutputs = (next: OutputState) => {
    setOutputState(next);
    saveOutputs(next);
  };
  // Changes from the Outputs sheet refit the view; rate changes from the details panel do not,
  // even when they add or remove a node, so the chart stays where the player is looking.
  const [pickerChanges, setPickerChanges] = useState(0);
  const changeOutputsFromPicker = (next: OutputState, toggled: Item) => {
    changeOutputs(next);
    setPickerChanges((count) => count + 1);
    // Select the toggled item's node, as a click on it would, or clear the selection when
    // turning it off took it off the chart.
    const nextFlow = computeFlow(data, next.outputs, { productivity });
    const recipe = nextFlow.producerOf.get(toggled.id);
    const onChart = (nextFlow.itemRate.get(toggled.id) ?? 0) > 0;
    setSelection(
      onChart
        ? { kind: "node", node: recipe ? `recipe:${recipe}` : `raw:${toggled.id}` }
        : undefined,
    );
  };
  const changeOutputRate = (item: ItemId, perSecond: number) =>
    changeOutputs(setOutputRate(data, outputState, item, perSecond));

  const flow = useMemo(() => computeFlow(data, outputs, { productivity }), [outputs, productivity]);
  const beltPerSecond = data.belts.find((tier) => tier.id === preferences.belt)?.perSecond ?? 15;
  const { nodeOrder, laneReuse, outputNodes, orientation } = layoutSettings;
  const layout = useMemo(
    () =>
      layoutBus(data, flow, beltPerSecond, {
        ...defaultLayoutOptions,
        nodeOrder,
        laneReuse,
        outputNodes,
      }),
    [flow, beltPerSecond, nodeOrder, laneReuse, outputNodes],
  );
  const measureLayouts = useCallback(
    () => layoutSizes(data, flow, beltPerSecond, { ...defaultLayoutOptions, outputNodes }),
    [flow, beltPerSecond, outputNodes],
  );
  const beltName = (
    data.belts.find((tier) => tier.id === preferences.belt)?.shortName ?? "belt"
  ).toLowerCase();
  // A node under the mouse previews in place of the pinned selection.
  const [hoveredNode, setHoveredNode] = useState<string>();
  // Turning an output off can remove what was selected or hovered.
  const hovered: Selection | undefined = hoveredNode
    ? { kind: "node", node: hoveredNode }
    : undefined;
  const activeSelection = [hovered, selection].find(
    (candidate) => candidate && selectionExists(layout, candidate),
  );
  // The panel also keeps a pinned node that has left the chart, so its rate can be raised again.
  const panelSelection = activeSelection ?? (selection?.kind === "node" ? selection : undefined);
  // Refit the view when what is on the chart or how it is arranged changes, but not for rates.
  const fitKey = [orientation, nodeOrder, laneReuse, outputNodes, pickerChanges].join("|");

  return (
    <div css={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
      <header
        css={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 16px",
          paddingTop: "max(10px, env(safe-area-inset-top))",
          position: "relative",
          borderBottom: `1px solid ${palette.border}`,
          background: palette.surface,
        }}
      >
        <h1
          css={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 0.2,
            // The header buttons need the full width of a phone; the title is the first to go.
            [mobile]: {
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clipPath: "inset(50%)",
            },
          }}
        >
          Production bus
        </h1>
        <div css={{ display: "flex", alignItems: "center", gap: 8 }}>
          <OutputPicker data={data} state={outputState} onChange={changeOutputsFromPicker} />
          <BuildPicker data={data} preferences={preferences} onChange={changePreferences} />
          <LayoutPicker
            settings={layoutSettings}
            onChange={changeLayoutSettings}
            measure={measureLayouts}
            beltName={beltName}
          />
        </div>
      </header>

      <main css={{ position: "relative", overflow: "hidden" }}>
        {outputs.length === 0 ? (
          <div
            css={{
              display: "grid",
              placeItems: "center",
              height: "100%",
              padding: 24,
              color: palette.muted,
              fontSize: 14,
              textAlign: "center",
            }}
          >
            Nothing to make yet. Open Outputs and pick what your factory should produce.
          </div>
        ) : (
          <BusChart
            data={data}
            flow={flow}
            layout={layout}
            preferences={preferences}
            orientation={orientation}
            selection={activeSelection}
            onSelect={setSelection}
            onHoverNode={setHoveredNode}
            fitKey={fitKey}
          />
        )}
        {panelSelection && (
          <SelectionPanel
            data={data}
            flow={flow}
            layout={layout}
            selection={panelSelection}
            preferences={preferences}
            outputState={outputState}
            onOutputRateChange={changeOutputRate}
          />
        )}
      </main>
    </div>
  );
}
