import { addDays, differenceInCalendarDays, isWeekend } from "date-fns";
import type { Dataset, Importance, OrderType, ScheduleAssignment } from "./types";
import { bookedHrs, dayCapacityHrs, isEligible, itemFor } from "./capacity";
import { estimatedRunTimeHrs, runOnlyHrs, setupHrs } from "./runtime";
import { DEFAULT_THRESHOLDS, type RiskLevel } from "./risk";
import { fromISO, toISO } from "../lib/util";

// BRD §5.6 prioritisation. Lower rank = scheduled first.
const TYPE_RANK: Record<OrderType, number> = { Customer: 0, Stock: 1, eComm: 2 };
const IMP_RANK: Record<Importance, number> = { High: 0, Medium: 1, Low: 2 };

export interface SchedulerOptions {
  horizonDays: number;    // how far ahead the engine may place work
  atRiskDays: number;     // buffer at/under which a placement is "at-risk"
}
export const DEFAULT_OPTIONS: SchedulerOptions = { horizonDays: 20, atRiskDays: DEFAULT_THRESHOLDS.atRiskDays };

/** One placed segment of an order (Tier-2 split may produce several). */
export interface PlacementSegment {
  laneId: string;
  laneCode: string;
  date: string;
  qty: number;
  runHrs: number;
  batched: boolean;
}

export interface ProposalItem {
  orderId: string;
  productionNo: string;
  itemNumber: string;
  itemType: string;
  qty: number;
  orderType: OrderType;
  importance: Importance;
  neededBy: string;
  placed: boolean;
  laneId?: string;
  laneCode?: string;
  date?: string;
  runHrs?: number;
  batched: boolean;       // shares a lane-day with a same-item run (setup saved)
  setupSaved: number;     // hours of setup avoided by batching
  segments?: PlacementSegment[]; // present when an order is split across lane-days
  risk: RiskLevel | "unplaceable";
  reason: string;         // human-readable explanation
}

export interface Proposal {
  items: ProposalItem[];
  placedCount: number;
  onTimeCount: number;
  atRiskCount: number;
  lateCount: number;
  unplaceableCount: number;
  setupHrsSaved: number;
}

export function riskFor(date: string, neededBy: string, atRiskDays: number): RiskLevel {
  const buffer = differenceInCalendarDays(fromISO(neededBy), fromISO(date));
  if (buffer < 0) return "late";
  if (buffer <= atRiskDays) return "at-risk";
  return "on-time";
}

/** Working days in [today, today+horizon]. */
function horizonDays(today: string, n: number): string[] {
  const out: string[] = [];
  let d = fromISO(today);
  for (let i = 0; i <= n; i++) {
    if (!isWeekend(d)) out.push(toISO(d));
    d = addDays(d, 1);
  }
  return out;
}

/**
 * Auto-scheduling engine (BRD §5.6). Proposes a lane/day for every unscheduled
 * order in a location without exceeding capacity or lane eligibility. Nothing is
 * committed — the planner reviews the returned proposal.
 *
 * Sequencing: need-by date, then order-type priority (Customer first), then
 * importance. Placement: earliest eligible lane-day that keeps the order on-time;
 * if none, earliest feasible day (flagged at-risk/late); if nothing fits in the
 * horizon, the order is returned unplaceable with a reason.
 *
 * Batching: if a candidate lands on a lane-day that already holds a run of the
 * same item, setup is shared (not re-charged), reducing booked hours.
 *
 * Manual/committed (locked) assignments are never moved — the engine schedules
 * around them (FR-AS-4).
 */
export function runAutoSchedule(
  ds: Dataset,
  locationId: string,
  today: string,
  opts: SchedulerOptions = DEFAULT_OPTIONS,
): Proposal {
  // Work on a copy of assignments so placements accumulate as we go.
  const work: Dataset = { ...ds, assignments: [...ds.assignments] };
  const orderItem = new Map(ds.orders.map((o) => [o.id, o.itemNumber]));

  const lanes = ds.lanes.filter((l) => l.locationId === locationId);
  const days = horizonDays(today, opts.horizonDays);

  const candidates = ds.orders
    .filter((o) => o.locationId === locationId && o.status !== "Completed" && !ds.assignments.some((a) => a.orderId === o.id))
    .sort((a, b) =>
      a.neededBy.localeCompare(b.neededBy) ||
      TYPE_RANK[a.orderType] - TYPE_RANK[b.orderType] ||
      IMP_RANK[a.importance] - IMP_RANK[b.importance],
    );

  const items: ProposalItem[] = [];

  for (const order of candidates) {
    const item = itemFor(ds, order);
    const base: ProposalItem = {
      orderId: order.id, productionNo: order.productionNo, itemNumber: order.itemNumber,
      itemType: item?.type ?? "?", qty: order.qtyNeeded, orderType: order.orderType,
      importance: order.importance, neededBy: order.neededBy,
      placed: false, batched: false, setupSaved: 0, risk: "unplaceable", reason: "",
    };

    if (!item) { items.push({ ...base, reason: `unknown item ${order.itemNumber}` }); continue; }

    const eligible = lanes.filter((l) => isEligible(l, item).ok);
    if (!eligible.length) {
      items.push({ ...base, reason: `no eligible ${item.type} lane at this location` });
      continue;
    }

    // Enumerate every feasible placement across the horizon.
    type Placement = { laneId: string; laneCode: string; date: string; runHrs: number; batched: boolean; setupSaved: number; risk: RiskLevel };
    const placements: Placement[] = [];

    for (const date of days) {
      for (const lane of eligible) {
        const cap = dayCapacityHrs(work, lane.id, date);
        if (cap <= 0) continue;
        const booked = bookedHrs(work, lane.id, date);
        const batched = work.assignments.some((a) => a.laneId === lane.id && a.date === date && orderItem.get(a.orderId) === item.itemNumber);
        const runHrs = batched ? runOnlyHrs(item, order.qtyNeeded) : estimatedRunTimeHrs(item, order.qtyNeeded);
        if (booked + runHrs > cap + 1e-9) continue;
        placements.push({
          laneId: lane.id, laneCode: lane.code, date, runHrs, batched,
          setupSaved: batched ? setupHrs(item) : 0, risk: riskFor(date, order.neededBy, opts.atRiskDays),
        });
      }
    }

    if (!placements.length) {
      items.push({ ...base, reason: `no capacity in the next ${opts.horizonDays} days on an eligible lane` });
      continue;
    }

    // Best placement: on-time first, then earliest day, then batched, then most headroom.
    const riskScore = (r: RiskLevel) => (r === "on-time" ? 0 : r === "at-risk" ? 1 : 2);
    placements.sort((a, b) =>
      riskScore(a.risk) - riskScore(b.risk) ||
      a.date.localeCompare(b.date) ||
      Number(b.batched) - Number(a.batched),
    );
    const best = placements[0];

    // Commit to the working set so later candidates see the load + batching.
    const virtual: ScheduleAssignment = {
      id: `virtual_${order.id}`, orderId: order.id, laneId: best.laneId, date: best.date,
      qty: order.qtyNeeded, runHrs: best.runHrs, locked: false,
    };
    work.assignments.push(virtual);

    items.push({
      ...base, placed: true, laneId: best.laneId, laneCode: best.laneCode, date: best.date,
      runHrs: best.runHrs, batched: best.batched, setupSaved: best.setupSaved, risk: best.risk,
      reason: best.risk === "late" ? "placed, but completes after need-by"
        : best.risk === "at-risk" ? "placed with little buffer before need-by"
        : best.batched ? "batched with a same-item run — setup shared"
        : "placed on-time",
    });
  }

  const placed = items.filter((i) => i.placed);
  return {
    items,
    placedCount: placed.length,
    onTimeCount: placed.filter((i) => i.risk === "on-time").length,
    atRiskCount: placed.filter((i) => i.risk === "at-risk").length,
    lateCount: placed.filter((i) => i.risk === "late").length,
    unplaceableCount: items.length - placed.length,
    setupHrsSaved: Math.round(placed.reduce((s, i) => s + i.setupSaved, 0) * 100) / 100,
  };
}
