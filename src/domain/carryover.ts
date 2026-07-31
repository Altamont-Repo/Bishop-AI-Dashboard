import { addDays, isWeekend } from "date-fns";
import type { Dataset, Item, Order } from "./types";
import { canFit, dayCapacityHrs } from "./capacity";
import { estimatedRunTimeHrs, runOnlyHrs, setupHrs } from "./runtime";
import { fromISO, toISO } from "../lib/util";

export function remainingQty(order: Order): number {
  return Math.max(0, order.qtyNeeded - order.qtyProduced);
}

/** A single planned lane-day segment. */
export interface PlannedSegment {
  laneId: string;
  date: string;
  qty: number;
  runHrs: number;
}

/**
 * Fit `qty` of an item onto a lane starting after `afterDate`, spilling across
 * consecutive working days when a single day can't hold it. Respects each day's
 * remaining capacity. Setup is charged once on the first day of the run.
 * Returns the segments placed (may be fewer units than requested if the horizon
 * runs out).
 */
export function planFit(
  ds: Dataset,
  laneId: string,
  item: Item,
  qty: number,
  afterDate: string,
  horizonDays = 30,
): PlannedSegment[] {
  const segments: PlannedSegment[] = [];
  let remaining = qty;
  let cursor = addDays(fromISO(afterDate), 1);
  let daysScanned = 0;
  let firstDay = true;

  while (remaining > 0 && daysScanned < horizonDays) {
    const date = toISO(cursor);
    cursor = addDays(cursor, 1);
    if (isWeekend(fromISO(date))) continue;
    daysScanned += 1;

    const cap = dayCapacityHrs(ds, laneId, date);
    if (cap <= 0) continue;
    const bookedThisPlan = segments
      .filter((s) => s.date === date)
      .reduce((h, s) => h + s.runHrs, 0);
    const already = cap - remainingAfter(ds, laneId, date) + bookedThisPlan;
    const free = cap - already;
    if (free <= 0.01) continue;

    const perUnit = item.prodTimePerUnitMins / 60;
    const setup = firstDay ? setupHrs(item) : 0;
    const usableForUnits = free - setup;
    if (usableForUnits <= 0) continue;

    const unitsThatFit = Math.min(remaining, Math.floor(usableForUnits / perUnit));
    if (unitsThatFit <= 0) continue;

    const runHrs = setup + runOnlyHrs(item, unitsThatFit);
    segments.push({ laneId, date, qty: unitsThatFit, runHrs });
    remaining -= unitsThatFit;
    firstDay = false;
  }
  return segments;
}

function remainingAfter(ds: Dataset, laneId: string, date: string): number {
  const cap = dayCapacityHrs(ds, laneId, date);
  const booked = ds.assignments
    .filter((a) => a.laneId === laneId && a.date === date)
    .reduce((s, a) => s + a.runHrs, 0);
  return cap - booked;
}

/** Whole-order single-day fit check used by the board on drop. */
export function orderFitsSingleDay(ds: Dataset, laneId: string, date: string, item: Item, qty: number, ignoreAssignmentId?: string): boolean {
  return canFit(ds, laneId, date, estimatedRunTimeHrs(item, qty), ignoreAssignmentId);
}
