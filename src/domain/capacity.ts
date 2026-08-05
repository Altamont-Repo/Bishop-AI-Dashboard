import type { Dataset, Item, Lane, Order, ScheduleAssignment } from "./types";

/** Capacity for a lane on a day. A day override is used verbatim; otherwise the
 *  lane's hard cap plus its allowed overtime buffer. */
export function dayCapacityHrs(ds: Dataset, laneId: string, date: string): number {
  const override = ds.laneDays.find((d) => d.laneId === laneId && d.date === date);
  if (override) return override.capacityHrs;
  const lane = ds.lanes.find((l) => l.id === laneId);
  return lane ? lane.defaultCapacityHrs + (lane.overtimeHrs ?? 0) : 0;
}

/** Hours already booked on a lane-day across all assignments. */
export function bookedHrs(ds: Dataset, laneId: string, date: string): number {
  return ds.assignments
    .filter((a) => a.laneId === laneId && a.date === date)
    .reduce((sum, a) => sum + a.runHrs, 0);
}

export interface LaneDayLoad {
  capacity: number;
  booked: number;
  remaining: number;
  pct: number;       // 0..>1
  over: boolean;
}

export function laneDayLoad(ds: Dataset, laneId: string, date: string): LaneDayLoad {
  const capacity = dayCapacityHrs(ds, laneId, date);
  const booked = bookedHrs(ds, laneId, date);
  const remaining = capacity - booked;
  const pct = capacity > 0 ? booked / capacity : booked > 0 ? 1 : 0;
  return { capacity, booked, remaining, pct, over: booked > capacity + 1e-9 };
}

/** A lane accepts an order only if the item type matches the lane type (BRD FR-LM-3),
 *  and any item special-req tags are covered by the lane's skill tags (FR-IM-4). */
export function isEligible(lane: Lane, item: Item): { ok: boolean; reason?: string } {
  if (!lane.types.includes(item.type)) {
    return { ok: false, reason: `no ${item.type} capability on ${lane.code}` };
  }
  const missing = item.specialReqs.filter((t) => !lane.skillTags.includes(t));
  if (missing.length) {
    return { ok: false, reason: `missing skill: ${missing.join(", ")}` };
  }
  return { ok: true };
}

/** Can `hrs` of work be added to this lane-day without breaking the hard cap? */
export function canFit(ds: Dataset, laneId: string, date: string, hrs: number, ignoreAssignmentId?: string): boolean {
  const capacity = dayCapacityHrs(ds, laneId, date);
  const booked = ds.assignments
    .filter((a) => a.laneId === laneId && a.date === date && a.id !== ignoreAssignmentId)
    .reduce((s, a) => s + a.runHrs, 0);
  return booked + hrs <= capacity + 1e-9;
}

export function itemFor(ds: Dataset, order: Order): Item | undefined {
  return ds.items.find((i) => i.itemNumber === order.itemNumber);
}

export function assignmentsFor(ds: Dataset, orderId: string): ScheduleAssignment[] {
  return ds.assignments.filter((a) => a.orderId === orderId);
}
