import type { ProductionData } from "../data/types.ts";
import {
  type BuildPreferences,
  followedGroups,
  type MachineGroup,
  type ModuleChoice,
  machineGroups,
  moduleChoices,
} from "../lib/buildPreferences.ts";
import { type Choice, ChoiceRow } from "../shared/ChoiceRow.tsx";
import { Popover } from "../shared/Popover.tsx";
import { YieldField } from "./YieldField.tsx";

const groupLabel: Partial<Record<MachineGroup, string>> = {
  mining: "Drill",
  smelting: "Furnace",
  crafting: "Assembler",
};

const moduleChoiceText: Record<ModuleChoice, { name: string; description: string }> = {
  none: { name: "None", description: "No modules." },
  speed: {
    name: "Speed",
    description: "Speed modules in every machine that has slots, so fewer machines are needed.",
  },
  productivity: {
    name: "Productivity",
    description:
      "Productivity modules in every machine with slots whose recipe allows them: intermediates, science, and mining. Each craft yields extra, so less is needed upstream.",
  },
  mixed: {
    name: "Mixed",
    description:
      "Productivity modules where a recipe allows them and speed modules everywhere else.",
  },
};

interface BuildPickerProps {
  data: ProductionData;
  preferences: BuildPreferences;
  onChange: (preferences: BuildPreferences) => void;
}

/**
 * Header control for the machine, belt, and module tiers the player builds with. The button
 * shows the current picks as icons; tapping it opens a sheet with one row of choices for each.
 */
export function BuildPicker({ data, preferences, onChange }: BuildPickerProps) {
  const icon = (src: string | undefined, size = 28) =>
    src && <img key={src} src={src} alt="" width={size} height={size} />;
  const moduleOf = (kind: "speed" | "productivity", tier = preferences.moduleTier) =>
    data.modules.find((module) => module.kind === kind && module.tier === tier);
  // The kind whose icons stand for the current choice; mixed is shown by productivity.
  const shownKind = preferences.modules === "speed" ? "speed" : "productivity";

  const machineRows = machineGroups(data).flatMap((group) => {
    const options = data.machines.filter((machine) => machine.categories.includes(group));
    // A group with one machine, such as the oil refinery in vanilla, offers no choice, and a
    // group that follows another takes that group's choice.
    if (options.length < 2 || followedGroups[group]) return [];
    return {
      key: group,
      label: groupLabel[group] ?? group,
      choices: options.map(
        (machine): Choice => ({
          id: machine.id,
          name: machine.name,
          description: `${machine.name}, ${machine.moduleSlots === 0 ? "no module slots" : `${machine.moduleSlots} module slots`}`,
          content: icon(machine.icon),
        }),
      ),
      selected: preferences.machines[group],
      choose: (id: string) =>
        onChange({ ...preferences, machines: { ...preferences.machines, [group]: id } }),
      picked: options.find((machine) => machine.id === preferences.machines[group])?.icon,
    };
  });
  const beltRow = {
    key: "belt",
    label: "Belt",
    choices: data.belts.map(
      (belt): Choice => ({ id: belt.id, name: belt.name, content: icon(belt.icon) }),
    ),
    selected: preferences.belt,
    choose: (id: string) => onChange({ ...preferences, belt: id }),
    picked: data.belts.find((belt) => belt.id === preferences.belt)?.icon,
  };
  const modulesRow = {
    key: "modules",
    label: "Modules",
    choices: moduleChoices.map(
      (choice): Choice => ({
        id: choice,
        name: moduleChoiceText[choice].name,
        description: moduleChoiceText[choice].description,
        content:
          choice === "none" ? undefined : choice === "mixed" ? (
            <span css={{ display: "flex", gap: 2 }}>
              {icon(moduleOf("productivity")?.icon, 22)}
              {icon(moduleOf("speed")?.icon, 22)}
            </span>
          ) : (
            icon(moduleOf(choice)?.icon)
          ),
      }),
    ),
    selected: preferences.modules,
    choose: (id: string) => onChange({ ...preferences, modules: id as ModuleChoice }),
    picked: preferences.modules === "none" ? undefined : moduleOf(shownKind)?.icon,
  };
  const tiers = [...new Set(data.modules.map((module) => module.tier))];
  const tierRow = {
    key: "moduleTier",
    label: "Module tier",
    choices: tiers.map(
      (tier): Choice => ({
        id: String(tier),
        name: `Tier ${tier}`,
        content: icon(moduleOf(shownKind, tier)?.icon),
      }),
    ),
    selected: String(preferences.moduleTier),
    choose: (id: string) => onChange({ ...preferences, moduleTier: Number(id) }),
    disabledReason: preferences.modules === "none" ? "no modules chosen" : undefined,
  };
  const rows = [...machineRows, beltRow, modulesRow, tierRow];

  return (
    <Popover
      label="Build tiers"
      trigger={[...machineRows, beltRow, modulesRow].map((row) => icon(row.picked, 22))}
    >
      {rows.map((row) => (
        <ChoiceRow
          key={row.key}
          label={row.label}
          choices={row.choices}
          selected={row.selected}
          onChoose={row.choose}
          disabledReason={"disabledReason" in row ? row.disabledReason : undefined}
        />
      ))}
      <YieldField
        value={preferences.pumpjackYield}
        onChange={(pumpjackYield) => onChange({ ...preferences, pumpjackYield })}
      />
    </Popover>
  );
}
