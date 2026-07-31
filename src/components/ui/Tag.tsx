import type { OrderStatus } from "../../domain/types";
import type { RiskLevel } from "../../domain/risk";
import { RISK_LABEL, RISK_TAG } from "../../domain/risk";

const STATUS_CLASS: Record<OrderStatus, string> = {
  Pending: "ns",
  Scheduled: "scheduled",
  WIP: "wip",
  Completed: "completed",
};

export function StatusTag({ status }: { status: OrderStatus }) {
  return <span className={`tag ${STATUS_CLASS[status]}`}>{status === "Pending" ? "Not started" : status}</span>;
}

export function RiskTag({ level }: { level: RiskLevel }) {
  return <span className={`tag ${RISK_TAG[level]}`}>{RISK_LABEL[level]}</span>;
}

export function ImportanceTag({ importance }: { importance: "High" | "Medium" | "Low" }) {
  const cls = importance === "High" ? "late" : importance === "Medium" ? "risk" : "ok";
  return <span className={`tag ${cls}`}>{importance}</span>;
}
