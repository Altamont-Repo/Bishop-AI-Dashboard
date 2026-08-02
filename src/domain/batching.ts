import { addDays, differenceInCalendarDays, isWeekend } from "date-fns";
import type { Dataset, Item, Order } from "./types";
import { dayCapacityHrs, bookedHrs, isEligible, itemFor } from "./capacity";
import { fromISO, toISO } from "../lib/util";

export interface BatchOrderRef {
  id: string;
  productionNo: string;
  qty: number;
  neededBy: string;
  orderType: Order["orderType"];
}

export interface BatchGroup {
  id: string;                       // stable key for the group
  itemNumber: string;
  itemType: string;
  description: string;
  orders: BatchOrderRef[];          // ≥ 2 orders that can share a setup
  totalQty: number;
  setupSavedHrs: number;            // (n − 1) × setup
  combinedHrs: number;              // setup + Σ run  (the batched footprint)
  spanDays: number;                 // need-by spread within the group
  eligibleLanes: { id: string; code: string }[];
}

/** Earliest working day on `laneId` (from today, within horizon) whose remaining
 *  capacity can hold `hrs`, or null if it doesn't fit in the horizon. */
export function earliestFit(ds: Dataset, laneId: string, hrs: number, today: string, horizonDays = 20): string | null {
  let d = fromISO(today);
  for (let i = 0; i <= horizonDays; i++, d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const date = toISO(d);
    const remaining = dayCapacityHrs(ds, laneId, date) - bookedHrs(ds, laneId, date);
    if (remaining + 1e-9 >= hrs) return date;
  }
  return null;
}

/**
 * Batching recommendations (BRD §5.9). Groups unscheduled orders of the SAME
 * item whose need-by dates fall within `windowDays` of each other — producing
 * them together shares one machine setup instead of paying it per order.
 * Setup saving = (groupSize − 1) × item setup time.
 */
export function findBatchGroups(ds: Dataset, locationId: string, windowDays: number): BatchGroup[] {
  const unscheduled = ds.orders.filter(
    (o) => o.locationId === locationId && o.status !== "Completed" && !ds.assignments.some((a) => a.orderId === o.id),
  );

  // Bucket by item.
  const byItem = new Map<string, Order[]>();
  unscheduled.forEach((o) => {
    if (!byItem.has(o.itemNumber)) byItem.set(o.itemNumber, []);
    byItem.get(o.itemNumber)!.push(o);
  });

  const groups: BatchGroup[] = [];
  for (const list of byItem.values()) {
    if (list.length < 2) continue;
    const item = itemFor(ds, list[0]) as Item | undefined;
    if (!item) continue;

    // Cluster by need-by proximity (window from the cluster's earliest need-by).
    const sorted = [...list].sort((a, b) => a.neededBy.localeCompare(b.neededBy));
    let cluster: Order[] = [];
    const flush = () => {
      if (cluster.length >= 2) groups.push(makeGroup(ds, item, cluster, locationId));
      cluster = [];
    };
    sorted.forEach((o) => {
      if (!cluster.length) { cluster = [o]; return; }
      if (differenceInCalendarDays(fromISO(o.neededBy), fromISO(cluster[0].neededBy)) <= windowDays) cluster.push(o);
      else { flush(); cluster = [o]; }
    });
    flush();
  }

  // Biggest savings first.
  return groups.sort((a, b) => b.setupSavedHrs - a.setupSavedHrs || b.orders.length - a.orders.length);
}

function makeGroup(ds: Dataset, item: Item, cluster: Order[], locationId: string): BatchGroup {
  const totalQty = cluster.reduce((s, o) => s + o.qtyNeeded, 0);
  const setupSavedHrs = ((cluster.length - 1) * item.setupTimeMins) / 60;
  const combinedHrs = (item.setupTimeMins + totalQty * item.prodTimePerUnitMins) / 60;
  const dates = cluster.map((o) => o.neededBy).sort();
  const spanDays = differenceInCalendarDays(fromISO(dates[dates.length - 1]), fromISO(dates[0]));
  const eligibleLanes = ds.lanes
    .filter((l) => l.locationId === locationId && isEligible(l, item).ok)
    .map((l) => ({ id: l.id, code: l.code }));

  return {
    id: `batch_${item.itemNumber}_${cluster.map((o) => o.productionNo).join("_")}`,
    itemNumber: item.itemNumber,
    itemType: item.type,
    description: item.description,
    orders: cluster.map((o) => ({ id: o.id, productionNo: o.productionNo, qty: o.qtyNeeded, neededBy: o.neededBy, orderType: o.orderType })),
    totalQty,
    setupSavedHrs: Math.round(setupSavedHrs * 100) / 100,
    combinedHrs: Math.round(combinedHrs * 100) / 100,
    spanDays,
    eligibleLanes,
  };
}
