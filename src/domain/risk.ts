import { differenceInCalendarDays } from "date-fns";
import type { Order, ScheduleAssignment } from "./types";
import { fromISO } from "../lib/util";

/** Brand-compliant risk levels (BRD §5.7 — NO green):
 *  on-time = neutral/ink, at-risk = amber, late = Bishop red. */
export type RiskLevel = "on-time" | "at-risk" | "late";

export interface RiskThresholds {
  /** Days of buffer at/under which an order is "at-risk". */
  atRiskDays: number;
}
export const DEFAULT_THRESHOLDS: RiskThresholds = { atRiskDays: 3 };

/** Latest scheduled day across an order's assignments (its projected completion). */
export function scheduledCompletion(assignments: ScheduleAssignment[]): string | undefined {
  if (!assignments.length) return undefined;
  return assignments.reduce((max, a) => (a.date > max ? a.date : max), assignments[0].date);
}

/**
 * Classify an order against its need-by date.
 * - Completed orders are always on-time (they're done).
 * - Scheduled: compare projected completion to need-by.
 * - Unscheduled: compare need-by to `today` (can it still be placed in time?).
 */
export function classifyRisk(
  order: Order,
  assignments: ScheduleAssignment[],
  today: string,
  th: RiskThresholds = DEFAULT_THRESHOLDS,
): RiskLevel {
  if (order.status === "Completed") return "on-time";

  const needBy = fromISO(order.neededBy);
  const completion = scheduledCompletion(assignments);

  if (completion) {
    const buffer = differenceInCalendarDays(needBy, fromISO(completion));
    if (buffer < 0) return "late";
    if (buffer <= th.atRiskDays) return "at-risk";
    return "on-time";
  }

  // Unscheduled — judge against today.
  const daysToNeed = differenceInCalendarDays(needBy, fromISO(today));
  if (daysToNeed < 0) return "late";
  if (daysToNeed <= th.atRiskDays) return "at-risk";
  return "on-time";
}

/** Reason string surfaced on auto-flagged orders. */
export function riskReason(level: RiskLevel, _order: Order, assignments: ScheduleAssignment[]): string {
  if (level === "on-time") return "";
  const scheduled = assignments.length > 0;
  if (level === "late") {
    return scheduled ? "scheduled past need-by date" : "need-by date has passed, still unscheduled";
  }
  return scheduled ? "little buffer before need-by" : "at-risk of missing need-by if not scheduled soon";
}

export const RISK_TAG: Record<RiskLevel, string> = {
  "on-time": "ok",
  "at-risk": "risk",
  late: "late",
};
export const RISK_LABEL: Record<RiskLevel, string> = {
  "on-time": "on-time",
  "at-risk": "at-risk",
  late: "late",
};
