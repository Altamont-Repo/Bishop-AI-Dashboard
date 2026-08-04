import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { Importance, OrderType } from "../../domain/types";
import { estimatedRunTimeHrs } from "../../domain/runtime";
import { fmtHrs } from "../../lib/util";
import { Modal } from "../../components/ui/Modal";
import { Field } from "./NewOrderModal";

export function EditOrderModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const ds = useAppStore((s) => s.ds);
  const updateOrder = useAppStore((s) => s.updateOrder);
  const order = ds.orders.find((o) => o.id === orderId);

  const [productionNo, setProductionNo] = useState(order?.productionNo ?? "");
  const [itemNumber, setItemNumber] = useState(order?.itemNumber ?? "");
  const [qty, setQty] = useState(order?.qtyNeeded ?? 1);
  const [orderType, setOrderType] = useState<OrderType>(order?.orderType ?? "Customer");
  const [importance, setImportance] = useState<Importance>(order?.importance ?? "Medium");
  const [neededBy, setNeededBy] = useState(order?.neededBy ?? "");
  const [value, setValue] = useState(order?.value ?? 0);

  const item = useMemo(() => ds.items.find((i) => i.itemNumber === itemNumber), [ds.items, itemNumber]);
  const runHrs = item ? estimatedRunTimeHrs(item, qty) : 0;

  if (!order) return null;

  const submit = () => {
    if (!productionNo.trim() || !item) return;
    updateOrder(orderId, { productionNo: productionNo.trim(), itemNumber, qtyNeeded: qty, orderType, importance, neededBy, value });
    onClose();
  };

  return (
    <Modal
      title={`Edit order · ${order.productionNo}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!productionNo.trim() || !item}>Save changes</button>
      </>}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Production #">
          <input type="text" value={productionNo} onChange={(e) => setProductionNo(e.target.value)} placeholder="e.g. RS-0100" autoFocus />
        </Field>
        <Field label="SKU / item">
          <select value={itemNumber} onChange={(e) => setItemNumber(e.target.value)}>
            {ds.items.map((i) => <option key={i.id} value={i.itemNumber}>{i.itemNumber} — {i.description}</option>)}
          </select>
        </Field>

        {item && (
          <div style={{ background: "var(--steel-light)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "var(--navy2)" }}>
            <b>{item.type}</b> · setup {item.setupTimeMins}m · {item.prodTimePerUnitMins}m/unit
            {item.specialReqs.length > 0 && <> · reqs: {item.specialReqs.join(", ")}</>}
            <div style={{ marginTop: 4 }}>Est. run time: <b>{fmtHrs(runHrs)}</b> <span className="muted">= ({item.setupTimeMins} + {qty} × {item.prodTimePerUnitMins}) / 60</span></div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Qty needed"><input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} /></Field>
          <Field label="Value ($)"><input type="number" min={0} value={value} onChange={(e) => setValue(Number(e.target.value))} /></Field>
          <Field label="Order type">
            <select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
              {["Stock", "Customer", "eComm"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Importance">
            <select value={importance} onChange={(e) => setImportance(e.target.value as Importance)}>
              {["High", "Medium", "Low"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Needed by"><input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
