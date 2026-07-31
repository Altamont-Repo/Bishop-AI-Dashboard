import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Order, OrderStatus } from "../../domain/types";
import { assignmentsFor } from "../../domain/capacity";
import { remainingQty } from "../../domain/carryover";
import { fmtMoney } from "../../lib/util";
import { Kpi } from "../../components/ui/Kpi";
import { StatusTag } from "../../components/ui/Tag";
import styles from "./Status.module.css";

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; primary?: boolean }>> = {
  Pending: { to: "Scheduled", label: "Mark scheduled" },
  Scheduled: { to: "WIP", label: "Start (WIP)" },
  WIP: { to: "Completed", label: "Mark complete", primary: true },
};

export function StatusView() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const role = useAppStore((s) => s.role);
  const today = useAppStore((s) => s.today);
  const setStatus = useAppStore((s) => s.setStatus);
  const recordProduced = useAppStore((s) => s.recordProduced);
  const carryOver = useAppStore((s) => s.carryOver);
  const canUpdate = can(role).updateStatus;

  const orders = useMemo(() => ds.orders.filter((o) => o.locationId === locationId), [ds.orders, locationId]);
  const completedToday = orders.filter((o) => o.status === "Completed" && o.updatedAt.slice(0, 10) === today);

  const kpis = {
    notStarted: orders.filter((o) => o.status === "Pending").length,
    scheduled: orders.filter((o) => o.status === "Scheduled").length,
    wip: orders.filter((o) => o.status === "WIP").length,
    completeToday: completedToday.length,
    valueToday: completedToday.reduce((s, o) => s + o.value, 0),
  };

  const active = orders.filter((o) => o.status !== "Completed");

  return (
    <>
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Kpi label="Not started" value={kpis.notStarted} />
        <Kpi label="Scheduled" value={kpis.scheduled} />
        <Kpi label="In progress" value={kpis.wip} />
        <Kpi label="Value shipped (today)" value={fmtMoney(kpis.valueToday)} delta={`${kpis.completeToday} completed`} deltaDir="up" />
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr><th>Production #</th><th>SKU</th><th>Lane</th><th>Progress</th><th>Status</th>{canUpdate && <th>Update</th>}</tr>
          </thead>
          <tbody>
            {active.map((o) => <Row key={o.id} order={o} canUpdate={canUpdate} onStatus={setStatus} onProduced={recordProduced} onCarry={carryOver} laneLabel={laneLabel(ds, o)} />)}
            {!active.length && <tr><td colSpan={canUpdate ? 6 : 5} className="muted" style={{ padding: 20, textAlign: "center" }}>Nothing in progress — all caught up.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="hint">Operator view — advance each order along the lifecycle (Not started → Scheduled → WIP → Complete) and record quantity produced. When produced qty reaches the order qty the order auto-completes; leftover quantity can be carried to the next available day.</div>
    </>
  );
}

function laneLabel(ds: ReturnType<typeof useAppStore.getState>["ds"], o: Order): string {
  const a = assignmentsFor(ds, o.id);
  if (!a.length) return "—";
  const lane = ds.lanes.find((l) => l.id === a[0].laneId);
  return a.length > 1 ? `${a.length} segments` : `${lane?.code ?? "?"}`;
}

function Row({ order, canUpdate, onStatus, onProduced, onCarry, laneLabel }: {
  order: Order; canUpdate: boolean; laneLabel: string;
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
