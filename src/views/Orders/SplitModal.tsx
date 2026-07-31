import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { isEligible, itemFor } from "../../domain/capacity";
import { estimatedRunTimeHrs } from "../../domain/runtime";
import { fmtHrs, toISO } from "../../lib/util";
import { Modal } from "../../components/ui/Modal";

interface Part { laneId: string; date: string; qty: number; }

export function SplitModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const ds = useAppStore((s) => s.ds);
  const today = useAppStore((s) => s.today);
  const splitOrder = useAppStore((s) => s.splitOrder);
  const toast = useAppStore((s) => s.toast);

  const order = ds.orders.find((o) => o.id === orderId)!;
  const item = itemFor(ds, order)!;
  const eligibleLanes = useMemo(
    () => ds.lanes.filter((l) => l.locationId === order.locationId && isEligible(l, item).ok),
    [ds.lanes, order.locationId, item],
  );

  const [parts, setParts] = useState<Part[]>([
    { laneId: eligibleLanes[0]?.id ?? "", date: today, qty: Math.ceil(order.qtyNeeded / 2) },
    { laneId: eligibleLanes[0]?.id ?? "", date: toISO(new Date(today)), qty: Math.floor(order.qtyNeeded / 2) },
  ]);

  const total = parts.reduce((s, p) => s + (Number(p.qty) || 0), 0);
  const balanced = total === order.qtyNeeded;

  const update = (i: number, patch: Partial<Part>) => setParts(parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPart = () => setParts([...parts, { laneId: eligibleLanes[0]?.id ?? "", date: today, qty: 0 }]);
  const removePart = (i: number) => setParts(parts.filter((_, idx) => idx !== i));

  const submit = () => {
    if (!balanced) { toast("error", `Segments total ${total}, must equal ${order.qtyNeeded}`); return; }
    if (parts.some((p) => !p.laneId)) { toast("error", "Every segment needs a lane"); return; }
    splitOrder(orderId, parts.filter((p) => p.qty > 0));
    onClose();
  };

  return (
    <Modal
      title={`Split ${order.productionNo} — ${order.qtyNeeded} units`}
      onClose={onClose}
      width={560}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!balanced}>Apply split</button>
      </>}
    >
      {!eligibleLanes.length && <p className="hint">No eligible {item.type} lanes at this location.</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {parts.map((p, i) => (
          <div key={i} className="row" style={{ gap: 8 }}>
            <select value={p.laneId} onChange={(e) => update(i, { laneId: e.target.value })} style={{ flex: 1 }}>
              {eligibleLanes.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
            </select>
            <input type="date" value={p.date} onChange={(e) => update(i, { date: e.target.value })} />
            <input type="number" min={0} value={p.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} style={{ width: 80 }} />
            <span className="muted nowrap" style={{ fontSize: 11 }}>{fmtHrs(estimatedRunTimeHrs(item, Number(p.qty) || 0))}</span>
            <button className="btn ghost sm" onClick={() => removePart(i)} disabled={parts.length <= 1}>✕</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
        <button className="btn sm" onClick={addPart}>+ Add segment</button>
        <span style={{ fontSize: 12, color: balanced ? "var(--done)" : "var(--red)", fontWeight: 600 }}>
          {total} / {order.qtyNeeded} units allocated
        </span>
      </div>
      <div className="hint">Splitting places one assignment per segment on the board. Carry-over of unfinished quantity is handled from the Status board.</div>
    </Modal>
  );
}
