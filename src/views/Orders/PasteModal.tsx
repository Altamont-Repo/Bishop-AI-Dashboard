import { useMemo, useState } from "react";
import { useAppStore, type PastedOrder } from "../../store/useAppStore";
import type { Importance, OrderType } from "../../domain/types";
import { toISO } from "../../lib/util";
import { addDays } from "date-fns";
import { Modal } from "../../components/ui/Modal";

/**
 * Paste tab-separated rows (as copied from a spreadsheet):
 *   ProductionNo <tab> SKU <tab> Qty <tab> OrderType <tab> Importance <tab> NeededBy <tab> Value
 * Only ProductionNo, SKU and Qty are required; the rest fall back to sane defaults.
 */
function parse(text: string, items: Set<string>, today: string): { rows: PastedOrder[]; errors: string[] } {
  const rows: PastedOrder[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const c = line.split(/\t|,/).map((x) => x.trim());
    if (/production/i.test(c[0]) && /sku|item/i.test(c[1] ?? "")) return; // header
    const [prod, sku, qtyStr, type, imp, needBy, valStr] = c;
    if (!prod || !sku) { errors.push(`Line ${i + 1}: needs at least production # and SKU`); return; }
    if (!items.has(sku)) { errors.push(`Line ${i + 1}: unknown SKU "${sku}"`); return; }
    const qty = Number(qtyStr) || 1;
    rows.push({
      productionNo: prod, itemNumber: sku, qtyNeeded: qty,
      orderType: (["Stock", "Customer", "eComm"].includes(type) ? type : "Customer") as OrderType,
      importance: (["High", "Medium", "Low"].includes(imp) ? imp : "Medium") as Importance,
      neededBy: needBy && !Number.isNaN(Date.parse(needBy)) ? toISO(new Date(needBy)) : toISO(addDays(new Date(today), 7)),
      value: Number(valStr) || 0,
    });
  });
  return { rows, errors };
}

export function PasteModal({ onClose }: { onClose: () => void }) {
  const items = useAppStore((s) => s.ds.items);
  const today = useAppStore((s) => s.today);
  const pasteOrders = useAppStore((s) => s.pasteOrders);
  const [text, setText] = useState("");

  const skuSet = useMemo(() => new Set(items.map((i) => i.itemNumber)), [items]);
  const { rows, errors } = useMemo(() => parse(text, skuSet, today), [text, skuSet, today]);

  const submit = () => { if (rows.length) { pasteOrders(rows); onClose(); } };

  return (
    <Modal
      title="Paste orders from clipboard"
      onClose={onClose}
      width={620}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!rows.length}>Import {rows.length || ""} order{rows.length === 1 ? "" : "s"}</button>
      </>}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        Paste rows copied from a spreadsheet. Columns (tab or comma separated):
        <br /><code>Production# · SKU · Qty · Type · Importance · NeededBy · Value</code>
      </p>
      <textarea
        rows={7} value={text} onChange={(e) => setText(e.target.value)} autoFocus
        placeholder={"RS-0201\tRS-1206\t40\tCustomer\tHigh\t2026-08-15\t12000\nFW-0201\tFS-2010\t25\tStock\tMedium"}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ marginTop: 10, fontSize: 12 }}>
        <b>{rows.length}</b> valid row{rows.length === 1 ? "" : "s"} ready.
        {errors.length > 0 && (
          <ul style={{ color: "var(--red)", margin: "6px 0 0", paddingLeft: 18 }}>
            {errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
