import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Order, OrderStatus } from "../../domain/types";
import { assignmentsFor } from "../../domain/capacity";
import { remainingQty } from "../../domain/carryover";
import { fmtMoney, fmtShort, fromISO, workWeek } from "../../lib/util";
import { Kpi } from "../../components/ui/Kpi";
import { StatusTag } from "../../components/ui/Tag";
import styles from "./Status.module.css";

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; primary?: boolean }>> = {
  Pending: { to: "Scheduled", label: "Mark scheduled" },
  Scheduled: { to: "WIP", label: "Start (WIP)" },
  WIP: { to: "Completed", label: "Mark complete", primary: true },
};

type Tab = "today" | "week" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All orders" },
];
// Suffix appended to KPI labels so each view's scope is unambiguous.
const SCOPE_SUFFIX: Record<Tab, string> = { today: " (today)", week: " (this week)", all: " (all)" };

export function StatusView() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const role = useAppStore((s) => s.role);
  const today = useAppStore((s) => s.today);
  const setStatus = useAppStore((s) => s.setStatus);
  const recordProduced = useAppStore((s) => s.recordProduced);
  const carryOver = useAppStore((s) => s.carryOver);
  const canUpdate = can(role).updateStatus;

  const [tab, setTab] = useState<Tab>("today");
  const weekDays = useMemo(() => new Set(workWeek(fromISO(today))), [today]);

  const orders = useMemo(() => ds.orders.filter((o) => o.locationId === locationId), [ds.orders, locationId]);

  // Which orders belong to each tab, by their assignment dates.
  const inScope = (o: Order, scope: Tab): boolean => {
    if (scope === "all") return true;
    const dates = assignmentsFor(ds, o.id).map((a) => a.date);
    return scope === "today" ? dates.includes(today) : dates.some((d) => weekDays.has(d));
  };

  const counts: Record<Tab, number> = {
    today: orders.filter((o) => inScope(o, "today")).length,
    week: orders.filter((o) => inScope(o, "week")).length,
    all: orders.length,
  };

  // Rows for the active tab, ordered by the earliest relevant scheduled day.
  const rows = useMemo(() => {
    const scoped = orders.filter((o) => inScope(o, tab));
    const firstDate = (o: Order) => {
      const dates = assignmentsFor(ds, o.id).map((a) => a.date).sort();
      return dates[0] ?? "9999-12-31"; // unscheduled sinks to the bottom
    };
    return [...scoped].sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || a.productionNo.localeCompare(b.productionNo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, tab, ds, today, weekDays]);

  // KPIs summarise the active tab's scope. Value scheduled = total $ of the
  // orders in view that are actually placed on the board (have an assignment).
  const scheduledInScope = rows.filter((o) => assignmentsFor(ds, o.id).length > 0);
  const kpis = {
    notStarted: rows.filter((o) => o.status === "Pending").length,
    scheduled: rows.filter((o) => o.status === "Scheduled").length,
    wip: rows.filter((o) => o.status === "WIP").length,
    valueScheduled: scheduledInScope.reduce((s, o) => s + o.value, 0),
    scheduledCount: scheduledInScope.length,
  };

  const emptyMsg: Record<Tab, string> = {
    today: "Nothing scheduled to run today.",
    week: "Nothing scheduled this week.",
    all: "No orders at this location yet.",
  };

  return (
    <>
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Kpi label={`Not scheduled${SCOPE_SUFFIX[tab]}`} value={kpis.notStarted} />
        <Kpi label={`Scheduled${SCOPE_SUFFIX[tab]}`} value={kpis.scheduled} />
        <Kpi label={`In progress${SCOPE_SUFFIX[tab]}`} value={kpis.wip} />
        <Kpi label={`Value scheduled${SCOPE_SUFFIX[tab]}`} value={fmtMoney(kpis.valueScheduled)} delta={`${kpis.scheduledCount} order${kpis.scheduledCount === 1 ? "" : "s"} on the board`} deltaDir="up" />
      </div>

      <div className="tab-strip">
        {TABS.map((t) => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label} <span className="badge-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr><th>Production #</th><th>SKU</th><th>Lane</th><th>Scheduled</th><th>Progress</th><th>Status</th>{canUpdate && <th>Update</th>}</tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <Row
                key={o.id} order={o} canUpdate={canUpdate}
                onStatus={setStatus} onProduced={recordProduced} onCarry={carryOver}
                laneLabel={laneLabel(ds, o)} whenLabel={whenLabel(ds, o, today)}
              />
            ))}
            {!rows.length && <tr><td colSpan={canUpdate ? 7 : 6} className="muted" style={{ padding: 20, textAlign: "center" }}>{emptyMsg[tab]}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="hint">
        {tab === "today" && "Orders with production scheduled on today's date — the floor's work for today."}
        {tab === "week" && "Orders with production scheduled anywhere in the current work week (Mon–Fri)."}
        {tab === "all" && "Every order at this location across the full lifecycle, including completed."}
        {" "}Advance each order along Not scheduled → Scheduled → WIP → Complete and record quantity produced; leftover quantity can be carried to the next available day.
      </div>
    </>
  );
}

function laneLabel(ds: ReturnType<typeof useAppStore.getState>["ds"], o: Order): string {
  const a = assignmentsFor(ds, o.id);
  if (!a.length) return "—";
  const lane = ds.lanes.find((l) => l.id === a[0].laneId);
  return a.length > 1 ? `${a.length} segments` : `${lane?.code ?? "?"}`;
}

/** Scheduled-day label: "—" if unscheduled, "Today" when it runs today, else the date (with +N for multi-day). */
function whenLabel(ds: ReturnType<typeof useAppStore.getState>["ds"], o: Order, today: string): string {
  const dates = [...new Set(assignmentsFor(ds, o.id).map((a) => a.date))].sort();
  if (!dates.length) return "—";
  if (dates.includes(today)) return "Today";
  const extra = dates.length > 1 ? ` +${dates.length - 1}` : "";
  return `${fmtShort(dates[0])}${extra}`;
}

function Row({ order, canUpdate, onStatus, onProduced, onCarry, laneLabel, whenLabel }: {
  order: Order; canUpdate: boolean; laneLabel: string; whenLabel: string;
  onStatus: (id: string, s: OrderStatus) => void;
  onProduced: (id: string, q: number) => void;
  onCarry: (id: string) => number;
}) {
  const [qty, setQty] = useState(order.qtyProduced);
  const next = NEXT[order.status];
  const rem = remainingQty(order);

  return (
    <tr>
      <td><b>{order.productionNo}</b></td>
      <td>{order.itemNumber}</td>
      <td className="muted">{laneLabel}</td>
      <td className={whenLabel === "Today" ? "" : "muted"} style={whenLabel === "Today" ? { fontWeight: 700 } : undefined}>{whenLabel}</td>
      <td>
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${Math.round((order.qtyProduced / order.qtyNeeded) * 100)}%` }} /></div>
          <span className={styles.progressNum}>{order.qtyProduced}/{order.qtyNeeded}</span>
        </div>
      </td>
      <td><StatusTag status={order.status} /></td>
      {canUpdate && (
        <td>
          <div className="row" style={{ gap: 6 }}>
            {order.status === "WIP" && (
              <>
                <input type="number" min={0} max={order.qtyNeeded} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 66 }} />
                <button className="btn sm" onClick={() => onProduced(order.id, qty)}>Log</button>
                {rem > 0 && <button className="btn ghost sm" title={`Carry ${rem} units to next day`} onClick={() => onCarry(order.id)}>Carry over</button>}
              </>
            )}
            {next && <button className={`btn sm ${next.primary ? "primary" : ""}`} onClick={() => onStatus(order.id, next.to)}>{next.label}</button>}
          </div>
        </td>
      )}
    </tr>
  );
}
