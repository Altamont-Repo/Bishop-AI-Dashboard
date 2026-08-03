import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Item, ItemType } from "../../domain/types";
import { fmtMoney } from "../../lib/util";
import { useSort, type Accessor } from "../../lib/useSort";
import { Modal } from "../../components/ui/Modal";
import { SortableTh } from "../../components/ui/SortableTh";
import { Field } from "../Orders/NewOrderModal";

const BLANK: Omit<Item, "id"> = {
  itemNumber: "", description: "", type: "Round", prodTimePerUnitMins: 5,
  setupTimeMins: 15, listPrice: 0, hardwareNeeded: false, specialReqs: [],
};

// Module-level so the accessor map keeps a stable identity across renders.
const ITEM_SORT: Record<string, Accessor<Item>> = {
  itemNumber: (i) => i.itemNumber.toLowerCase(),
  description: (i) => i.description.toLowerCase(),
  type: (i) => i.type,
  prodTimePerUnitMins: (i) => i.prodTimePerUnitMins,
  setupTimeMins: (i) => i.setupTimeMins,
  listPrice: (i) => i.listPrice,
  hardwareNeeded: (i) => i.hardwareNeeded,
  specialReqs: (i) => i.specialReqs.join(", ").toLowerCase(),
};

export function ItemsView() {
  const items = useAppStore((s) => s.ds.items);
  const role = useAppStore((s) => s.role);
  const addItem = useAppStore((s) => s.addItem);
  const updateItem = useAppStore((s) => s.updateItem);
  const deleteItem = useAppStore((s) => s.deleteItem);
  const canEdit = can(role).editMasters;

  const [q, setQ] = useState("");
  const [type, setType] = useState("All");
  const [editing, setEditing] = useState<Item | "new" | null>(null);

  const filtered = useMemo(() => items.filter((i) =>
    (type === "All" || i.type === type) &&
    (!q || `${i.itemNumber} ${i.description}`.toLowerCase().includes(q.toLowerCase())),
  ), [items, q, type]);
  const { sorted: rows, sortKey, sortDir, toggle } = useSort(filtered, ITEM_SORT, "itemNumber");

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <input type="text" placeholder="Search item #" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="chip-select" value={type} onChange={(e) => setType(e.target.value)}>
            {["All", "Round", "Flat", "Special"].map((t) => <option key={t} value={t}>{t === "All" ? "All types" : t}</option>)}
          </select>
        </div>
        {canEdit && <button className="btn primary" onClick={() => setEditing("new")}>+ New item</button>}
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <SortableTh label="Item #" col="itemNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Description" col="description" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Type" col="type" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Prod. time/unit" col="prodTimePerUnitMins" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Setup/run" col="setupTimeMins" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="List price" col="listPrice" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Hardware" col="hardwareNeeded" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortableTh label="Special req." col="specialReqs" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><b>{i.itemNumber}</b></td>
                <td>{i.description}</td>
                <td>{i.type}</td>
                <td>{i.prodTimePerUnitMins} min</td>
                <td>{i.setupTimeMins} min</td>
                <td>{fmtMoney(i.listPrice)}</td>
                <td>{i.hardwareNeeded ? "Yes" : "No"}</td>
                <td className="muted">{i.specialReqs.join(", ") || "—"}</td>
                {canEdit && <td className="nowrap"><button className="btn ghost sm" onClick={() => setEditing(i)}>Edit</button><button className="btn ghost sm" onClick={() => { if (confirm(`Delete item ${i.itemNumber}? This can't be undone.`)) deleteItem(i.id); }}>Delete</button></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={canEdit ? 9 : 8} className="muted" style={{ padding: 20, textAlign: "center" }}>No items match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="hint">Production Time and Setup Time are in minutes and drive the estimated run-time calculation for every order using this item.</div>

      {editing && (
        <ItemModal
          initial={editing === "new" ? BLANK : editing}
          onClose={() => setEditing(null)}
          onSave={(data) => { editing === "new" ? addItem(data) : updateItem(editing.id, data); setEditing(null); }}
        />
      )}
    </>
  );
}

function ItemModal({ initial, onSave, onClose }: { initial: Omit<Item, "id">; onSave: (d: Omit<Item, "id">) => void; onClose: () => void }) {
  const [f, setF] = useState<Omit<Item, "id">>(initial);
  const set = (patch: Partial<Omit<Item, "id">>) => setF({ ...f, ...patch });
  return (
    <Modal
      title={initial.itemNumber ? `Edit ${initial.itemNumber}` : "New item"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(f)} disabled={!f.itemNumber.trim()}>Save</button></>}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Item # (SKU)"><input type="text" value={f.itemNumber} onChange={(e) => set({ itemNumber: e.target.value })} /></Field>
          <Field label="Type"><select value={f.type} onChange={(e) => set({ type: e.target.value as ItemType })}>{["Round", "Flat", "Special"].map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <Field label="Description"><input type="text" value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Prod. time/unit (min)"><input type="number" min={0} value={f.prodTimePerUnitMins} onChange={(e) => set({ prodTimePerUnitMins: Number(e.target.value) })} /></Field>
          <Field label="Setup/run (min)"><input type="number" min={0} value={f.setupTimeMins} onChange={(e) => set({ setupTimeMins: Number(e.target.value) })} /></Field>
          <Field label="List price ($)"><input type="number" min={0} value={f.listPrice} onChange={(e) => set({ listPrice: Number(e.target.value) })} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
          <Field label="Special requirements (comma-sep tags)">
            <input type="text" value={f.specialReqs.join(", ")} onChange={(e) => set({ specialReqs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="rig-cert, skill-3" />
          </Field>
          <label style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", paddingBottom: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.hardwareNeeded} onChange={(e) => set({ hardwareNeeded: e.target.checked })} /> Hardware needed
          </label>
        </div>
      </div>
    </Modal>
  );
}
