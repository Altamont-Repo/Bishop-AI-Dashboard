import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Role, User } from "../../domain/types";
import { Modal } from "../../components/ui/Modal";
import { Field } from "../Orders/NewOrderModal";
import { formatDistanceToNow } from "date-fns";
import { fromISO } from "../../lib/util";

const ROLES: Role[] = ["Production Planner", "Shift Operator", "Plant Manager", "Admin"];

export function AdminView() {
  const ds = useAppStore((s) => s.ds);
  const role = useAppStore((s) => s.role);
  const addUser = useAppStore((s) => s.addUser);
  const updateUser = useAppStore((s) => s.updateUser);
  const canManage = can(role).manageUsers;
  const [editing, setEditing] = useState<User | "new" | null>(null);

  const scopeLabel = (u: User) => u.locationScope.length === 0 ? "All locations" : u.locationScope.map((id) => ds.locations.find((l) => l.id === id)?.name ?? id).join(", ");

  return (
    <>
      <div className="toolbar">
        <div />
        {canManage && <button className="btn primary" onClick={() => setEditing("new")}>+ Invite user</button>}
      </div>

      <div className="card flush">
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Location scope</th><th>Status</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {ds.users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td>{u.role}</td>
                <td className="muted">{scopeLabel(u)}</td>
                <td><span className={`tag ${u.active ? "completed" : "ns"}`}>{u.active ? "Active" : "Inactive"}</span></td>
                {canManage && <td><button className="btn ghost sm" onClick={() => setEditing(u)}>Edit</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title">Audit trail <span className="hint" style={{ margin: 0 }}>every order & schedule change is attributed and timestamped (FR-ROLE-2)</span></div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
            <tbody>
              {ds.audit.slice(0, 100).map((a) => (
                <tr key={a.id}>
                  <td className="nowrap muted">{formatDistanceToNow(fromISO(a.at), { addSuffix: true })}</td>
                  <td>{a.userName}</td>
                  <td><span className={`tag ${a.action === "delete" ? "late" : a.action === "create" ? "scheduled" : "ns"}`}>{a.action}</span></td>
                  <td>{a.entity} <span className="muted">{a.entityRef}</span></td>
                  <td className="muted">{a.summary}</td>
                </tr>
              ))}
              {!ds.audit.length && <tr><td colSpan={5} className="muted" style={{ padding: 16, textAlign: "center" }}>No changes yet this session — make an edit and it will appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <UserModal
          initial={editing === "new" ? { name: "", role: "Shift Operator", locationScope: [], active: true } : editing}
          locations={ds.locations}
          onClose={() => setEditing(null)}
          onSave={(data) => { editing === "new" ? addUser(data) : updateUser(editing.id, data); setEditing(null); }}
        />
      )}
    </>
  );
}

function UserModal({ initial, locations, onSave, onClose }: {
  initial: Omit<User, "id">; locations: { id: string; name: string }[];
  onSave: (d: Omit<User, "id">) => void; onClose: () => void;
}) {
  const [f, setF] = useState<Omit<User, "id">>(initial);
  const set = (patch: Partial<Omit<User, "id">>) => setF({ ...f, ...patch });
  const toggleLoc = (id: string) => set({ locationScope: f.locationScope.includes(id) ? f.locationScope.filter((x) => x !== id) : [...f.locationScope, id] });
  return (
    <Modal
      title={initial.name ? `Edit ${initial.name}` : "Invite user"}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(f)} disabled={!f.name.trim()}>Save</button></>}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Name"><input type="text" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Role"><select value={f.role} onChange={(e) => set({ role: e.target.value as Role })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Location scope (none = all)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {locations.map((l) => (
              <label key={l.id} style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", border: "1px solid var(--line)", borderRadius: 4, padding: "4px 8px" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={f.locationScope.includes(l.id)} onChange={() => toggleLoc(l.id)} /> {l.name}
              </label>
            ))}
          </div>
        </Field>
        <label style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  );
}
