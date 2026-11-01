export type ItemId = string;
export type RecipeId = string;

/** Where a piece of content comes from, so a chart can be filtered to a game or a planet. */
export type ContentSource = "base" | "space-age";

export type ItemCategory =
  | "raw"
  | "intermediate"
  | "logistics"
  | "production"
  | "military"
  | "science"
  | "fluid";

/** The kind of machine a recipe runs in, matching the game's recipe categories. */
export type CraftingCategory =
  | "smelting"
  | "crafting"
  | "crafting-with-fluid"
  | "chemistry"
  | "oil-processing"
  | "centrifuging"
  | "rocket-building";

/** The kind of machine that extracts a raw item: drills, pumpjacks, or offshore pumps. */
export type ExtractionCategory = "mining" | "fluid-extraction" | "offshore";

export interface Item {
  id: ItemId;
  name: string;
  category: ItemCategory;
  source: ContentSource;
  planet?: string;
  /** Mined or pumped rather than crafted. Raw items have no recipe and start the bus. */
  raw?: boolean;
  /** Icon URL. Falls back to a generated placeholder when missing. */
  icon?: string;
  /** Line and frame color, bright but muted, reflecting the resource where possible. */
  color?: string;
  /** Seconds to extract one unit at speed 1, for raw items mined by drills or pumped. */
  miningTime?: number;
  /** Which machines extract this raw item. Defaults to "mining" when miningTime is set. */
  extraction?: ExtractionCategory;
  /** Why the chart cannot make this item yet, such as needing fluids; absent when it can. */
  unavailableReason?: string;
}

export interface Recipe {
  id: RecipeId;
  name?: string;
  category: ItemCategory;
  source: ContentSource;
  planet?: string;
  /** Which machines can run this recipe. */
  craftingCategory: CraftingCategory;
  /** Crafting time in seconds at speed 1. */
  time: number;
  inputs: Record<ItemId, number>;
  outputs: Record<ItemId, number>;
  /** Whether productivity modules may go in a machine running this recipe. */
  allowProductivity: boolean;
  /**
   * An extra producer of items that already have one, such as oil cracking, which the flow runs
   * only as much as it saves raw resources.
   */
  balancing?: boolean;
}

/** A building that crafts recipes or mines resources. Machines are listed lowest tier first. */
export interface Machine {
  id: string;
  name: string;
  icon?: string;
  source: ContentSource;
  /** Crafting speed for crafters, mining speed for drills. */
  speed: number;
  /** Recipe categories this machine can run, or the extraction category for drills and pumps. */
  categories: (CraftingCategory | ExtractionCategory)[];
  moduleSlots: number;
}

export type ModuleKind = "speed" | "productivity";

/** A module and what one of it does to the machine it sits in. */
export interface Module {
  id: string;
  name: string;
  icon?: string;
  source: ContentSource;
  kind: ModuleKind;
  tier: number;
  /** Change to crafting or mining speed as a fraction, such as 0.2 for +20%. */
  speed: number;
  /** Extra output as a fraction of normal output, such as 0.04 for +4%. */
  productivity: number;
}

/** A belt tier and what one fully compressed belt carries. Tiers are listed lowest first. */
export interface BeltTier {
  id: string;
  name: string;
  icon?: string;
  /** Short display name such as "Red", matching how players refer to the tier. */
  shortName: string;
  color: string;
  source: ContentSource;
  /** Items per second on a full belt, both lanes. */
  perSecond: number;
}

export interface ProductionData {
  items: Record<ItemId, Item>;
  recipes: Record<RecipeId, Recipe>;
  machines: Machine[];
  belts: BeltTier[];
  /** Modules lowest tier first within each kind. */
  modules: Module[];
  /** The recipe each item is made with by default where it has several. */
  preferredRecipes: Record<ItemId, RecipeId>;
}

/** An item the player wants out of the factory, at a rate the chart is sized for. */
export interface Output {
  item: ItemId;
  perSecond: number;
}
