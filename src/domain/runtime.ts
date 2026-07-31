import type { Item } from "./types";

/**
 * Estimated run time in hours (BRD FR-OM-6):
 *   Estimated Run Time = Setup Time + (Qty Needed × Production Time)
 * Times are stored in minutes; result is hours.
 *
 * Verified against Synthetics Production Planner.xlsx:
 *   RS-0001: (15 + 100×5)/60 = 8.583 hrs ✓
 *   SP-0001: (20 +   4×40)/60 = 3.000 hrs ✓
 */
export function estimatedRunTimeHrs(item: Pick<Item, "setupTimeMins" | "prodTimePerUnitMins">, qty: number): number {
  const mins = item.setupTimeMins + qty * item.prodTimePerUnitMins;
  return mins / 60;
}

/** Run hours excluding setup — used when a batch shares one setup. */
export function runOnlyHrs(item: Pick<Item, "prodTimePerUnitMins">, qty: number): number {
  return (qty * item.prodTimePerUnitMins) / 60;
}

export function setupHrs(item: Pick<Item, "setupTimeMins">): number {
  return item.setupTimeMins / 60;
}
