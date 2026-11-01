import type { Item } from "../data/types.ts";

/** Whether an item is a fluid, which travels in pipes rather than on belts. */
export const isFluid = (item: Item | undefined) => item?.category === "fluid";
