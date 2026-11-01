/**
 * Rounds a count of machines or belts up to the whole number to build. The small tolerance
 * keeps floating-point noise such as 2.0000000001 from asking for an extra one.
 */
export const roundUp = (count: number) => Math.max(0, Math.ceil(count - 1e-9));
