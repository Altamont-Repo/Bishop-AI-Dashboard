import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Location } from "../../domain/types";
import { Modal } from "../../components/ui/Modal";
import { Field } from "../Orders/NewOrderModal";

const BLANK: Omit<Location, "id"> = { name: "", address: "", city: "", state: "", zip: "" };

export function LocationsView() {
  const ds = useAppStore((s) => s.ds);
  const role = useAppStore((s) => s.role);
  const addLocation = useAppStore((s) => s.addLocation);
  const updateLocation = useAppStore((s) => s.updateLocation);
  const canEdit = can(role).editMasters;
  const [editing, setEditing] = useState<Location | "new" | null>(null);

  const laneCount = (id: string) => ds.lanes.filter((l) => l.locationId === id).length;

  return (
    <>
      <div className="toolbar">
        <div />
        {canEdit && <button className="btn primary" onClick={() => setEditing("new")}>+ New location</button>}
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>Location</th><th>Address</th><th>City</th><th>State</th><th>Zip</th><th>Lanes</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {ds.locations.map((l) => (
              <tr key={l.id}>
                <td><b>{l.name}</b></td><td>{l.address}</td><td>{l.city}</td><td>{l.state}</td><td>{l.zip}</td><td>{laneCount(l.id)}</td>
                {canEdit && <td><button className="btn ghost sm" onClick={() => setEditing(l)}>Edit</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">Release 1 pilots a single facility; every lane, order, and schedule is data-isolated per location for future multi-site onboarding.</div>

      {editing && (
        <LocationModal
          initial={editing === "new" ? BLANK : editing}
          onClose={() => setEditing(null)}
          onSave={(data) => { editing === "new" ? addLocation(data) : updateLocation(editing.id, data); setEditing(null); }}
        />
      )}
    </>
  );
}

function LocationModal({ initial, onSave, onClose }: { initial: Omit<Location, "id">; onSave: (d: Omit<Location, "id">) => void; onClose: () => void }) {
  const [f, setF] = useState<Omit<Location, "id">>(initial);
  const set = (patch: Partial<Omit<Location, "id">>) => setF({ ...f, ...patch });
  return (
    <Modal
      title={initial.name ? `Edit ${initial.name}` : "New location"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(f)} disabled={!f.name.trim()}>Save</button></>}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Location name"><input type="text" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Address"><input type="text" value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <Field label="City"><input type="text" value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="State"><input type="text" value={f.state} onChange={(e) => set({ state: e.target.value })} /></Field>
          <Field label="Zip"><input type="text" value={f.zip} onChange={(e) => set({ zip: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
