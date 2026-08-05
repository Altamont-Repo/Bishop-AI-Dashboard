import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Order } from "../../domain/types";
import { assignmentsFor, itemFor } from "../../domain/capacity";
import { estimatedRunTimeHrs } from "../../domain/runtime";
import { classifyRisk } from "../../domain/risk";
import { fmtDate, fmtHrs, fmtMoney } from "../../lib/util";
import { useSort, type Accessor } from "../../lib/useSort";
import { SortableTh } from "../../components/ui/SortableTh";
import { ImportanceTag, RiskTag, StatusTag } from "../../components/ui/Tag";
import { NewOrderModal } from "./NewOrderModal";
import { EditOrderModal } from "./EditOrderModal";
import { PasteModal } from "./PasteModal";
import { SplitModal } from "./SplitModal";

export function OrdersView() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const role = useAppStore((s) => s.role);
  const today = useAppStore((s) => s.today);
  const toggleFlag = useAppStore((s) => s.toggleFlag);
  const deleteOrder = useAppStore((s) => s.deleteOrder);
  const canEdit = can(role).editOrders;

  const [status, setStatus] = useState("All");
  const [type, setType] = useState("All");
  const [importance, setImportance] = useState("All");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const filtered = useMemo(() => ds.orders.filter((o) => {
    if (o.locationId !== locationId) return false;
    if (status !== "All" && o.status !== status) return false;
    if (type !== "All" && o.orderType !== type) return false;
    if (importance !== "All" && o.importance !== importance) return false;
    if (q && !`${o.productionNo} ${o.itemNumber}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [ds.orders, locationId, status, type, importance, q]);

  // Column sorters — importance & status rank by lifecycle order, not alphabet.
  const sorters = useMemo<Record<string, Accessor<Order>>>(() => {
    const impRank: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
    const statusRank: Record<string, number> = { Pending: 0, Scheduled: 1, WIP: 2, Completed: 3 };
    return {
      productionNo: (o) => o.productionNo.toLowerCase(),
      itemNumber: (o) => o.itemNumber.toLowerCase(),
      qtyNeeded: (o) => o.qtyNeeded,
      value: (o) => o.value,
      orderType: (o) => o.orderType,
      importance: (o) => impRank[o.importance] ?? 0,
      neededBy: (o) => o.neededBy,
      runHrs: (o) => { const it = itemFor(ds, o); return it ? estimatedRunTimeHrs(it, o.qtyNeeded) : 0; },
      status: (o) => statusRank[o.status] ?? 0,
    };
  }, [ds]);
  const { sorted: rows, sortKey, sortDir, toggle } = useSort(filtered, sorters, "productionNo");

  const assignedLabel = (o: Order): string => {
    const a = assignmentsFor(ds, o.id);
    if (!a.length) return "—";
    const lane = ds.lanes.find((l) => l.id === a[0].laneId);
    const loc = ds.locations.find((l) => l.id === o.locationId)?.name;
    return a.length > 1 ? `${a.length} segments` : `${loc} · ${lane?.code} · ${fmtDate(a[0].date)}`;
  };

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <select className="chip-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["All", "Pending", "Scheduled", "WIP", "Completed"].map((s) => <option key={s} value={s}>{s === "All" ? "All statuses" : s === "Pending" ? "Not started" : s}</option>)}
          </select>
          <select className="chip-select" value={type} onChange={(e) => setType(e.target.value)}>
            {["All", "Stock", "Customer", "eComm"].map((s) => <option key={s} value={s}>{s === "All" ? "All types" : s}</option>)}
          </select>
          <select className="chip-select" value={importance} onChange={(e) => setImportance(e.target.value)}>
            {["All", "High", "Medium", "Low"].map((s) => <option key={s} value={s}>{s === "All" ? "All importance" : s}</option>)}
          </select>
          <input type="text" placeholder="Search production # / SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canEdit && (
          <div className="row">
            <button className="btn" onClick={() => setShowPaste(true)}>Paste from clipboard</button>
            <button className="btn primary" onClick={() => setShowNew(true)}>+ New order</button>
          </div>
        )}
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <SortableTh label="Production #" col="productionNo" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="SKU" col="itemNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Qty" col="qtyNeeded" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Order value" col="value" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Order type" col="orderType" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Importance" col="importance" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Needed by" col="neededBy" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Est. run time" col="runHrs" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <th>Assigned</th><th>Flag</th>{canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const item = itemFor(ds, o);
              const level = classifyRisk(o, assignmentsFor(ds, o.id), today);
              const runHrs = item ? estimatedRunTimeHrs(item, o.qtyNeeded) : 0;
              return (
                <tr key={o.id}>
                  <td><b>{o.productionNo}</b></td>
                  <td>{o.itemNumber}</td>
                  <td>{o.qtyNeeded}</td>
                  <td>{fmtMoney(o.value)}</td>
                  <td>{o.orderType}</td>
                  <td><ImportanceTag importance={o.importance} /></td>
                  <td>{fmtDate(o.neededBy)}</td>
                  <td>{fmtHrs(runHrs)}</td>
                  <td><StatusTag status={o.status} /></td>
                  <td className="muted">{assignedLabel(o)}</td>
                  <td>
                    {o.flagged ? <span className="tag late" title={o.flagReason}>flagged</span>
                      : o.status !== "Completed" && level !== "on-time" ? <RiskTag level={level} />
                      : <span className="muted">—</span>}
                  </td>
                  {canEdit && (
                    <td className="nowrap">
                      <button className="btn ghost sm" onClick={() => setEditId(o.id)}>Edit</button>
                      <button className="btn ghost sm" onClick={() => setSplitId(o.id)} disabled={o.status === "Completed"}>Split</button>
                      <button className="btn ghost sm" onClick={() => toggleFlag(o.id, "manual review")}>{o.flagged ? "Unflag" : "Flag"}</button>
                      <button className="btn ghost sm" onClick={() => { if (confirm(`Delete order ${o.productionNo}? It will be removed from the board and can't be undone.`)) deleteOrder(o.id); }}>Delete</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={canEdit ? 12 : 11} className="muted" style={{ padding: 20, textAlign: "center" }}>No orders match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="hint">Selecting a SKU on a new order auto-fills product type, setup time, and run time from the item master. “Assigned” is system-maintained once an order is placed on the board. Importance and order type both feed the (upcoming) auto-scheduler's priority order.</div>

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} />}
      {editId && <EditOrderModal orderId={editId} onClose={() => setEditId(null)} />}
      {showPaste && <PasteModal onClose={() => setShowPaste(false)} />}
      {splitId && <SplitModal orderId={splitId} onClose={() => setSplitId(null)} />}
    </>
  );
}
