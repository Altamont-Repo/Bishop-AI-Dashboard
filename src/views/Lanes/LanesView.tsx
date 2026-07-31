import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { CapacityException, LaneType } from "../../domain/types";
import { dayCapacityHrs } from "../../domain/capacity";
import { fmtShort, workWeek } from "../../lib/util";
import { addDays } from "date-fns";

export function LanesView() {
  const [tab, setTab] = useState<"master" | "calendar">("master");
  return (
    <>
      <div className="tab-strip">
        <button className={`tab-btn ${tab === "master" ? "active" : ""}`} onClick={() => setTab("master")}>Lane master</button>
        <button className={`tab-btn ${tab === "calendar" ? "active" : ""}`} onClick={() => setTab("calendar")}>Capacity calendar</button>
      </div>
      {tab === "master" ? <LaneMaster /> : <CapacityCalendar />}
    </>
  );
}

function LaneMaster() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const role = useAppStore((s) => s.role);
  const addLane = useAppStore((s) => s.addLane);
  const updateLane = useAppStore((s) => s.updateLane);
  const deleteLane = useAppStore((s) => s.deleteLane);
  const canEdit = can(role).editMasters;
  const lanes = ds.lanes.filter((l) => l.locationId === locationId);
  const locName = ds.locations.find((l) => l.id === locationId)?.name;

  const [draft, setDraft] = useState<Record<string, number>>({});

  const addNew = () => {
    const n = lanes.length + 1;
    addLane({ locationId, code: `L-${String(n).padStart(2, "0")}`, name: `New Table ${n}`, type: "Flat", defaultCapacityHrs: 8, shiftsPerDay: 1, skillTags: [] });
  };

  return (
    <>
      <div className="toolbar">
        <div className="hint" style={{ margin: 0 }}>Lanes are custom per location. Hard capacity is the per-lane cap the scheduler won't book past.</div>
        {canEdit && <button className="btn primary" onClick={addNew}>+ New lane for {locName}</button>}
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>Lane / table</th><th>Code</th><th>Type</th><th>Hard cap (hrs/day)</th><th>Skill tags</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {lanes.map((l) => (
              <tr key={l.id}>
                <td>{canEdit ? <input type="text" defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && updateLane(l.id, { name: e.target.value })} style={{ width: 180 }} /> : l.name}</td>
                <td>{l.code}</td>
                <td>
                  {canEdit
                    ? <select defaultValue={l.type} onChange={(e) => updateLane(l.id, { type: e.target.value as LaneType })}>{["Round", "Flat", "Special"].map((t) => <option key={t}>{t}</option>)}</select>
                    : l.type}
                </td>
                <td>
                  {canEdit
                    ? <input type="number" min={0} value={draft[l.id] ?? l.defaultCapacityHrs} onChange={(e) => setDraft({ ...draft, [l.id]: Number(e.target.value) })} onBlur={() => draft[l.id] != null && draft[l.id] !== l.defaultCapacityHrs && updateLane(l.id, { defaultCapacityHrs: draft[l.id] })} style={{ width: 60 }} />
                    : l.defaultCapacityHrs}
                </td>
                <td>
                  {canEdit
                    ? <input type="text" defaultValue={l.skillTags.join(", ")} onBlur={(e) => updateLane(l.id, { skillTags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="—" style={{ width: 120 }} />
                    : (l.skillTags.join(", ") || "—")}
                </td>
                {canEdit && <td><button className="btn ghost sm" onClick={() => deleteLane(l.id)}>Delete</button></td>}
              </tr>
            ))}
            {!lanes.length && <tr><td colSpan={canEdit ? 6 : 5} className="muted" style={{ padding: 20, textAlign: "center" }}>No lanes for {locName}.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CapacityCalendar() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const today = useAppStore((s) => s.today);
  const role = useAppStore((s) => s.role);
  const setLaneDay = useAppStore((s) => s.setLaneDay);
  const applyRange = useAppStore((s) => s.applyRangeOverride);
  const canEdit = can(role).editMasters;

  const lanes = ds.lanes.filter((l) => l.locationId === locationId);
  const [weekOffset, setWeekOffset] = useState(0);
  const days = useMemo(() => workWeek(addDays(new Date(today), weekOffset * 7)), [today, weekOffset]);

  const [rangeCap, setRangeCap] = useState(8);
  const [rangeExc, setRangeExc] = useState<CapacityException>("Overtime");
  const [rangeLane, setRangeLane] = useState(lanes[0]?.id ?? "");

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <select className="chip-select" value={weekOffset} onChange={(e) => setWeekOffset(Number(e.target.value))}>
            <option value={0}>This week</option><option value={1}>Next week</option><option value={-1}>Last week</option>
          </select>
        </div>
        {canEdit && (
          <div className="row" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 11 }}>Apply to week:</span>
            <select className="chip-select" value={rangeLane} onChange={(e) => setRangeLane(e.target.value)}>{lanes.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
            <select className="chip-select" value={rangeExc} onChange={(e) => setRangeExc(e.target.value as CapacityException)}>{["Overtime", "PTO", "Maintenance", "Holiday"].map((x) => <option key={x}>{x}</option>)}</select>
            <input type="number" min={0} value={rangeCap} onChange={(e) => setRangeCap(Number(e.target.value))} style={{ width: 56 }} />
            <button className="btn" onClick={() => rangeLane && applyRange(rangeLane, days, rangeCap, rangeExc)}>Apply</button>
          </div>
        )}
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>Lane</th>{days.map((d) => <th key={d}>{fmtShort(d)}</th>)}</tr></thead>
          <tbody>
            {lanes.map((l) => (
              <tr key={l.id}>
                <td><b>{l.code}</b> <span className="muted">{l.type}</span></td>
                {days.map((d) => {
                  const cap = dayCapacityHrs(ds, l.id, d);
                  const override = ds.laneDays.find((x) => x.laneId === l.id && x.date === d);
                  return (
                    <td key={d}>
                      {canEdit
                        ? <input type="number" min={0} defaultValue={cap} onBlur={(e) => Number(e.target.value) !== cap && setLaneDay(l.id, d, Number(e.target.value), override?.exception)} style={{ width: 52 }} />
                        : `${cap} hr`}
                      {override && <div style={{ fontSize: 9.5, color: override.capacityHrs === 0 ? "var(--red)" : "var(--amber)", fontWeight: 700, marginTop: 2 }}>{override.exception}</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">Each day defaults to the lane's standard capacity and can be overridden for PTO, maintenance, holidays, or overtime. Available scheduling capacity = day capacity − already-booked run + setup hours.</div>
    </>
  );
}
