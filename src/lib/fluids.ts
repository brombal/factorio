import type { Item } from "../data/types.ts";

/** Whether an item is a fluid, which travels in pipes rather than on belts. */
export const isFluid = (item: Item | undefined) => item?.category === "fluid";

/**
 * Units per second one pumped pipeline carries, which is what a long fluid line is measured
 * in: a pump moves 1200/s (Factorio wiki, Pump, since 2.0.7), and pipes in 2.0 have no fixed
 * capacity of their own.
 */
export const pipePerSecond = 1200;
