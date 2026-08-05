import { useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAppStore } from "../../store/useAppStore";
import type { Dataset, Order } from "../../domain/types";
import { assignmentsFor, bookedHrs, dayCapacityHrs, itemFor } from "../../domain/capacity";
import { classifyRisk } from "../../domain/risk";
import { startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { fmtMoney, fmtShort, fromISO, toISO, workWeek } from "../../lib/util";
import { downloadCsv } from "../../lib/csv";
import { Kpi } from "../../components/ui/Kpi";

type Tab = "throughput" | "util" | "wip" | "mix";
const TABS: { key: Tab; label: string }[] = [
  { key: "throughput", label: "Throughput & on-time" },
  { key: "util", label: "Lane utilization" },
  { key: "wip", label: "Status board" },
  { key: "mix", label: "Order mix" },
];

// White / red brand palette — red primary, warm gray secondary, amber accent.
const C = { bar: "#c0392b", dark: "#8f8385", amber: "#c98a12", red: "#8f1f24", ink2: "#5b6b80", line: "#dfe3e8" };

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
    else downloadCsv("order-mix.csv", mixByOrderType(orders));
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
      {tab === "util" && <Utilization ds={ds} locationId={locationId} weekDays={days} />}
      {tab === "wip" && <Wip orders={orders} ds={ds} />}
      {tab === "mix" && <Mix orders={orders} ds={ds} today={today} />}
    </>
  );
}

/** Day a completed order is credited to: its latest assignment date, else updatedAt. */
function completionDay(o: Order, ds: Dataset): string {
  const a = ds.assignments.filter((x) => x.orderId === o.id);
  if (a.length) return a.reduce((m, x) => (x.date > m ? x.date : m), a[0].date);
  return o.updatedAt.slice(0, 10);
}

/** Is order `o` scheduled (has an assignment) on `date`? */
function onDate(ds: Dataset, o: Order, date: string): boolean {
  return assignmentsFor(ds, o.id).some((a) => a.date === date);
}

function perDay(orders: Order[], ds: Dataset, day: string) {
  const done = orders.filter((o) => o.status === "Completed" && completionDay(o, ds) === day);
  return {
    completed: done.length,
    units: done.reduce((s, o) => s + o.qtyProduced, 0),
    value: done.reduce((s, o) => s + o.value, 0),
  };
}

function Throughput({ orders, ds, days, today }: { orders: Order[]; ds: Dataset; days: string[]; today: string }) {
  const completed = orders.filter((o) => o.status === "Completed");
  const scheduledOrDone = orders.filter((o) => o.status !== "Pending");
  const onTime = scheduledOrDone.filter((o) => classifyRisk(o, [], today) === "on-time" || o.status === "Completed").length;
  const pctOnTime = scheduledOrDone.length ? Math.round((onTime / scheduledOrDone.length) * 100) : 100;
  const valueWk = completed.reduce((s, o) => s + o.value, 0);
  const unitsWk = completed.reduce((s, o) => s + o.qtyProduced, 0);
  const data = days.map((d) => ({ day: fmtShort(d), ...perDay(orders, ds, d) }));

  return (
    <>
      <div className="grid4" style={{ marginBottom: 14 }}>
        <Kpi label="Orders completed (wk)" value={completed.length} delta="this week" deltaDir="up" />
        <Kpi label="% on or before need-by" value={`${pctOnTime}%`} deltaDir={pctOnTime >= 90 ? "up" : "down"} delta={pctOnTime >= 90 ? "on target" : "below 90%"} />
        <Kpi label="Value shipped (wk)" value={fmtMoney(valueWk)} />
        <Kpi label="Units produced (wk)" value={unitsWk} />
      </div>
      <div className="card">
        <div className="section-title">Value shipped per day ($) — this week</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: DATA_RIGHT, left: DATA_LEFT - AXIS_W, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.ink2 }} />
            <YAxis width={AXIS_W} tick={{ fontSize: 11, fill: C.ink2 }} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => fmtMoney(Number(v) || 0)} />
            <Bar dataKey="value" name="value shipped ($)" fill={C.bar} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        {/* Data rows aligned under each bar: left gutter matches the plot's left
            offset (margin.left + YAxis width) and the right spacer matches margin.right. */}
        <div className="chart-datarows" style={{ gridTemplateColumns: `${DATA_LEFT}px repeat(${data.length}, 1fr) ${DATA_RIGHT}px` }}>
          <DataRow label="Value shipped" data={data} render={(r) => fmtMoney(r.value)} />
          <DataRow label="Orders completed" data={data} render={(r) => r.completed} />
          <DataRow label="Units produced" data={data} render={(r) => r.units} />
        </div>
      </div>
    </>
  );
}

// Layout constants shared by the Throughput chart and its data rows so the
// per-day value columns line up directly under each bar.
const AXIS_W = 44;     // YAxis width
const DATA_LEFT = 116; // left gutter = margin.left + AXIS_W (holds the row labels)
const DATA_RIGHT = 12; // right spacer = chart margin.right

interface DayDatum { day: string; completed: number; units: number; value: number }

function DataRow({ label, data, render }: { label: string; data: DayDatum[]; render: (r: DayDatum) => ReactNode }) {
  return (
    <>
      <div className="chart-datarows-label">{label}</div>
      {data.map((r) => <div key={r.day} className="chart-datarows-cell">{render(r)}</div>)}
      <div />
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

function Utilization({ ds, locationId, weekDays }: { ds: Dataset; locationId: string | null; weekDays: string[] }) {
  const [day, setDay] = useState("week");
  const scope = day === "week" ? weekDays : [day];
  const rows = laneUtil(ds, locationId, scope);
  const totalBooked = rows.reduce((s, r) => s + r.booked, 0);
  const totalAvail = rows.reduce((s, r) => s + r.available, 0);
  const idle = Math.max(0, totalAvail - totalBooked);
  const over = rows.filter((r) => r.pct > 100).length;
  const scopeLabel = day === "week" ? "this week (Mon–Fri)" : fmtShort(day);

  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 11 }}>Show:</span>
        <select className="chip-select" value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="week">Whole week</option>
          {weekDays.map((d) => <option key={d} value={d}>{fmtShort(d)}</option>)}
        </select>
      </div>
      <div className="grid4" style={{ marginBottom: 14 }}>
        <Kpi label={`Booked vs available (${day === "week" ? "wk" : "day"})`} value={`${totalAvail ? Math.round((totalBooked / totalAvail) * 100) : 0}%`} />
        <Kpi label={`Idle hours (${day === "week" ? "wk" : "day"})`} value={Math.round(idle)} />
        <Kpi label="Lanes tracked" value={rows.length} />
        <Kpi label="Lanes over-booked" value={over} deltaDir={over ? "down" : "up"} delta={over ? "review capacity" : "within cap"} />
      </div>
      <div className="card">
        <div className="section-title">Booked vs available hours by lane — {scopeLabel}</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
            <XAxis dataKey="code" tick={{ fontSize: 11, fill: C.ink2 }} />
            <YAxis tick={{ fontSize: 11, fill: C.ink2 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="available" name="available" fill={C.line} radius={[3, 3, 0, 0]} />
            <Bar dataKey="booked" name="booked" radius={[3, 3, 0, 0]}>
              {rows.map((r, i) => <Cell key={i} fill={r.pct > 100 ? C.red : C.bar} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="hint">Lane utilization is measured across the selected scope. Available hours include each lane's allowed overtime buffer; booked hours are the scheduled run + setup on the board.</div>
    </>
  );
}

function statusRows(orders: Order[]) {
  const statuses: Order["status"][] = ["Pending", "Scheduled", "WIP", "Completed"];
  return statuses.map((s) => {
    const list = orders.filter((o) => o.status === s);
    return { status: s === "Pending" ? "Not scheduled" : s, count: list.length, value: list.reduce((a, o) => a + o.value, 0) };
  });
}

function Wip({ orders, ds }: { orders: Order[]; ds: Dataset }) {
  const [date, setDate] = useState("");
  const scoped = date ? orders.filter((o) => onDate(ds, o, date)) : orders;
  const rows = statusRows(scoped);
  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 11 }}>Scheduled on date:</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {date && <button className="btn" onClick={() => setDate("")}>Clear</button>}
      </div>
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
      <div className="hint">{date ? `Showing orders scheduled on ${fmtShort(date)}.` : "Showing all orders in scope — pick a date to narrow to orders scheduled that day."}</div>
    </>
  );
}

function mixByOrderType(orders: Order[]) {
  const types = ["Stock", "Customer", "eComm"] as const;
  const totalVal = orders.reduce((s, o) => s + o.value, 0) || 1;
  return types.map((t) => {
    const list = orders.filter((o) => o.orderType === t);
    const value = list.reduce((s, o) => s + o.value, 0);
    return { type: t, orders: list.length, value, share: `${Math.round((value / totalVal) * 100)}%` };
  });
}

function mixByProductType(orders: Order[], ds: Dataset) {
  const types = ["Round", "Flat", "Special"] as const;
  const totalVal = orders.reduce((s, o) => s + o.value, 0) || 1;
  return types.map((t) => {
    const list = orders.filter((o) => itemFor(ds, o)?.type === t);
    const value = list.reduce((s, o) => s + o.value, 0);
    return { type: t, orders: list.length, value, share: `${Math.round((value / totalVal) * 100)}%` };
  });
}

function MixTable({ rows }: { rows: { type: string; orders: number; value: number; share: string }[] }) {
  return (
    <div className="card flush">
      <table>
        <thead><tr><th>Type</th><th>Orders</th><th>Value</th><th>Share ($)</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.type}><td>{r.type}</td><td>{r.orders}</td><td>{fmtMoney(r.value)}</td><td>{r.share}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function ValuePie({ rows, colors }: { rows: { type: string; value: number }[]; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="type" cx="50%" cy="50%" outerRadius={80} label={(e: { name?: string; value?: number }) => `${e.name}: ${fmtMoney(Number(e.value) || 0)}`}>
          {rows.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => fmtMoney(Number(v) || 0)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

type MixRange = "today" | "week" | "month" | "ytd" | "year" | "all";
const MIX_RANGES: { key: MixRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "ytd", label: "YTD" },
  { key: "year", label: "This year" },
  { key: "all", label: "All" },
];

/** Inclusive [lo, hi] ISO bounds for a range relative to `today`; null = no bound (All). */
function mixRangeBounds(range: MixRange, today: string): [string, string] | null {
  if (range === "all") return null;
  const t = fromISO(today);
  if (range === "today") return [today, today];
  if (range === "week") { const w = workWeek(t); return [w[0], w[w.length - 1]]; }
  if (range === "month") return [toISO(startOfMonth(t)), toISO(endOfMonth(t))];
  if (range === "ytd") return [toISO(startOfYear(t)), today];
  return [toISO(startOfYear(t)), toISO(endOfYear(t))]; // year
}

function Mix({ orders, ds, today }: { orders: Order[]; ds: Dataset; today: string }) {
  const [range, setRange] = useState<MixRange>("all");
  const bounds = mixRangeBounds(range, today);
  // Scope by need-by date so every order is attributable to a period regardless
  // of whether it's been scheduled yet.
  const scoped = bounds ? orders.filter((o) => o.neededBy >= bounds[0] && o.neededBy <= bounds[1]) : orders;
  const byOrder = mixByOrderType(scoped);
  const byProduct = mixByProductType(scoped, ds);
  const colors = [C.bar, C.dark, C.amber];
  const rangeLabel = MIX_RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <>
      <div className="tab-strip" style={{ marginBottom: 14 }}>
        {MIX_RANGES.map((r) => (
          <button key={r.key} className={`tab-btn ${range === r.key ? "active" : ""}`} onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
      </div>

      {!scoped.length && <div className="card"><div className="muted" style={{ padding: 16, textAlign: "center" }}>No orders with a need-by date in this period.</div></div>}

      <div className="grid2">
        <div className="card">
          <div className="section-title">Value by order type ($)</div>
          <ValuePie rows={byOrder} colors={colors} />
        </div>
        <MixTable rows={byOrder} />
      </div>

      <div className="grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-title">Value by product type ($)</div>
          <ValuePie rows={byProduct} colors={[C.dark, C.bar, C.amber]} />
        </div>
        <MixTable rows={byProduct} />
      </div>
      <div className="hint">Left: mix by order type (Stock / Customer / eComm). Right: mix by sling product type (Round / Flat / Special). Scoped to orders needed {range === "all" ? "across all dates" : rangeLabel} (by need-by date). All shares are by order value ($).</div>
    </>
  );
}
