import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAppStore } from "../../store/useAppStore";
import type { Dataset, Order } from "../../domain/types";
import { bookedHrs, dayCapacityHrs } from "../../domain/capacity";
import { classifyRisk } from "../../domain/risk";
import { fmtMoney, fmtShort, workWeek } from "../../lib/util";
import { downloadCsv } from "../../lib/csv";
import { Kpi } from "../../components/ui/Kpi";

type Tab = "throughput" | "util" | "wip" | "mix";
const TABS: { key: Tab; label: string }[] = [
  { key: "throughput", label: "Throughput & on-time" },
  { key: "util", label: "Lane utilization" },
  { key: "wip", label: "Status board" },
  { key: "mix", label: "Order mix" },
];

// Brand palette — NO green.
const C = { steel: "#3d5a80", navy: "#1b3155", amber: "#c98a12", red: "#b3272d", ink2: "#5b6b80", line: "#b7c2cf" };

export function DashboardsView() {
  const ds = useAppStore((s) => s.ds);
  const currentLoc = useAppStore((s) => s.locationId);
  const today = useAppStore((s) => s.today);
  const [tab, setTab] = useState<Tab>("throughput");
  const [locFilter, setLocFilter] = useState("current");
  const [typeFilter, setTypeFilter] = useState("All");

  const locationId = locFilter === "current" ? currentLoc : locFilter === "all" ? null : locFilter;
  const orders = useMemo(() => ds.orders.filter((o) =>
    (locationId === null || o.locationId === locationId) &&
    (typeFilter === "All" || o.orderType === typeFilter),
  ), [ds.orders, locationId, typeFilter]);

  const days = workWeek(new Date(today));

  const exportCurrent = () => {
    if (tab === "throughput") downloadCsv("throughput.csv", days.map((d) => ({ day: d, ...perDay(orders, ds, d) })));
    else if (tab === "util") downloadCsv("utilization.csv", laneUtil(ds, locationId, days).map((l) => ({ lane: l.code, booked: l.booked, available: l.available, utilization: `${l.pct}%` })));
    else if (tab === "wip") downloadCsv("status.csv", statusRows(orders));
    else downloadCsv("order-mix.csv", mixByType(orders));
  };

  return (
    <>
      <div className="tab-strip">
        {TABS.map((t) => <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      <div className="filters" style={{ marginBottom: 14 }}>
        <select className="chip-select" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
          <option value="current">This location</option>
          <option value="all">All locations</option>
          {ds.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="chip-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {["All", "Stock", "Customer", "eComm"].map((t) => <option key={t} value={t}>{t === "All" ? "All order types" : t}</option>)}
        </select>
        <button className="btn" onClick={exportCurrent}>Export CSV ▾</button>
      </div>

      {tab === "throughput" && <Throughput orders={orders} ds={ds} days={days} today={today} />}
      {tab === "util" && <Utilization ds={ds} locationId={locationId} days={days} />}
      {tab === "wip" && <Wip orders={orders} today={today} ds={ds} />}
      {tab === "mix" && <Mix orders={orders} />}
    </>
  );
}

/** Day a completed order is credited to: its latest assignment date, else updatedAt. */
function completionDay(o: Order, ds: Dataset): string {
  const a = ds.assignments.filter((x) => x.orderId === o.id);
  if (a.length) return a.reduce((m, x) => (x.date > m ? x.date : m), a[0].date);
  return o.updatedAt.slice(0, 10);
}

function perDay(orders: Order[], ds: Dataset, day: string) {
  const done = orders.filter((o) => o.status === "Completed" && completionDay(o, ds) === day);
  return { completed: done.length, value: done.reduce((s, o) => s + o.value, 0) };
}

function Throughput({ orders, ds, days, today }: { orders: Order[]; ds: Dataset; days: string[]; today: string }) {
  const completed = orders.filter((o) => o.status === "Completed");
  const scheduledOrDone = orders.filter((o) => o.status !== "Pending");
  const onTime = scheduledOrDone.filter((o) => classifyRisk(o, [], today) === "on-time" || o.status === "Completed").length;
  const pctOnTime = scheduledOrDone.length ? Math.round((onTime / scheduledOrDone.length) * 100) : 100;
  const valueWk = completed.reduce((s, o) => s + o.value, 0);
  const unknown = orders.filter((o) => !o.status).length;
  const data = days.map((d) => ({ day: fmtShort(d), ...perDay(orders, ds, d) }));

  return (
    <>
      <div className="grid4" style={{ marginBottom: 14 }}>
        <Kpi label="Orders completed (wk)" value={completed.length} delta="this week" deltaDir="up" />
        <Kpi label="% on or before need-by" value={`${pctOnTime}%`} deltaDir={pctOnTime >= 90 ? "up" : "down"} delta={pctOnTime >= 90 ? "on target" : "below 90%"} />
        <Kpi label="Value shipped (wk)" value={fmtMoney(valueWk)} />
        <Kpi label="Orders in unknown state" value={unknown} />
      </div>
      <div className="card">
        <div className="section-title">Completed orders per day</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.ink2 }} />
            <YAxis tick={{ fontSize: 11, fill: C.ink2 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="completed" name="completed" fill={C.steel} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function laneUtil(ds: Dataset, locationId: string | null, days: string[]) {
  return ds.lanes
    .filter((l) => locationId === null || l.locationId === locationId)
    .map((l) => {
      const booked = days.reduce((s, d) => s + bookedHrs(ds, l.id, d), 0);
      const available = days.reduce((s, d) => s + dayCapacityHrs(ds, l.id, d), 0);
      const pct = available ? Math.round((booked / available) * 100) : 0;
      return { code: l.code, name: l.name, booked: Math.round(booked * 10) / 10, available, pct };
    });
}

function Utilization({ ds, locationId, days }: { ds: Dataset; locationId: string | null; days: string[] }) {
  const rows = laneUtil(ds, locationId, days);
  const totalBooked = rows.reduce((s, r) => s + r.booked, 0);
  const totalAvail = rows.reduce((s, r) => s + r.available, 0);
  const idle = Math.max(0, totalAvail - totalBooked);
  const over = rows.filter((r) => r.pct > 100).length;

  return (
    <>
      <div className="grid4" style={{ marginBottom: 14 }}>
        <Kpi label="Booked vs available" value={`${totalAvail ? Math.round((totalBooked / totalAvail) * 100) : 0}%`} />
        <Kpi label="Idle hours (wk)" value={Math.round(idle)} />
        <Kpi label="Lanes tracked" value={rows.length} />
        <Kpi label="Lanes over-booked" value={over} deltaDir={over ? "down" : "up"} delta={over ? "review capacity" : "within cap"} />
      </div>
      <div className="card">
        <div className="section-title">Booked vs available hours by lane</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
            <XAxis dataKey="code" tick={{ fontSize: 11, fill: C.ink2 }} />
            <YAxis tick={{ fontSize: 11, fill: C.ink2 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="available" name="available" fill={C.line} radius={[3, 3, 0, 0]} />
            <Bar dataKey="booked" name="booked" radius={[3, 3, 0, 0]}>
              {rows.map((r, i) => <Cell key={i} fill={r.pct > 100 ? C.red : C.steel} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function statusRows(orders: Order[]) {
  const statuses: Order["status"][] = ["Pending", "Scheduled", "WIP", "Completed"];
  return statuses.map((s) => {
    const list = orders.filter((o) => o.status === s);
    return { status: s === "Pending" ? "Not started" : s, count: list.length, value: list.reduce((a, o) => a + o.value, 0) };
  });
}

function Wip({ orders }: { orders: Order[]; today: string; ds: Dataset }) {
  const rows = statusRows(orders);
  return (
    <div className="card flush">
      <table>
        <thead><tr><th>Status</th><th>Count</th><th>Value</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.status}><td>{r.status}</td><td>{r.count}</td><td>{fmtMoney(r.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function mixByType(orders: Order[]) {
  const types = ["Stock", "Customer", "eComm"] as const;
  const total = orders.length || 1;
  return types.map((t) => {
    const n = orders.filter((o) => o.orderType === t).length;
    return { type: t, orders: n, share: `${Math.round((n / total) * 100)}%` };
  });
}

function Mix({ orders }: { orders: Order[] }) {
  const byType = mixByType(orders);
  const colors = [C.steel, C.navy, C.amber];
  return (
    <div className="grid2">
      <div className="card">
        <div className="section-title">Volume by order type</div>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={byType} dataKey="orders" nameKey="type" cx="50%" cy="50%" outerRadius={80} label={(e: { name?: string; value?: number }) => `${e.name}: ${e.value}`}>
              {byType.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>Type</th><th>Orders</th><th>Share</th></tr></thead>
          <tbody>{byType.map((r) => <tr key={r.type}><td>{r.type}</td><td>{r.orders}</td><td>{r.share}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
