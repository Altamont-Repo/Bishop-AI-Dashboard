import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { addDays } from "date-fns";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Item, Lane, Order, ScheduleAssignment } from "../../domain/types";
import { assignmentsFor, isEligible, itemFor, laneDayLoad } from "../../domain/capacity";
import { orderFitsSingleDay } from "../../domain/carryover";
import { classifyRisk, RISK_TAG } from "../../domain/risk";
import { fmtHrs, fmtShort, fromISO, workWeek } from "../../lib/util";
import styles from "./Board.module.css";

type Filters = { type: string; importance: string; laneType: string; q: string };

export function BoardView() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const role = useAppStore((s) => s.role);
  const today = useAppStore((s) => s.today);
  const toast = useAppStore((s) => s.toast);
  const setView = useAppStore((s) => s.setView);
  const scheduleOrder = useAppStore((s) => s.scheduleOrder);
  const moveAssignment = useAppStore((s) => s.moveAssignment);
  const unschedule = useAppStore((s) => s.unschedule);

  const canEdit = can(role).editOrders;
  const [weekOffset, setWeekOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({ type: "All", importance: "All", laneType: "All", q: "" });

  const days = useMemo(() => workWeek(addDays(fromISO(today), weekOffset * 7)), [today, weekOffset]);
  const lanes = useMemo(
    () => ds.lanes.filter((l) => l.locationId === locationId && (filters.laneType === "All" || l.type === filters.laneType)),
    [ds.lanes, locationId, filters.laneType],
  );

  const matches = (o: Order): boolean => {
    if (filters.type !== "All" && o.orderType !== filters.type) return false;
    if (filters.importance !== "All" && o.importance !== filters.importance) return false;
    if (filters.q && !(`${o.productionNo} ${o.itemNumber}`.toLowerCase().includes(filters.q.toLowerCase()))) return false;
    return true;
  };

  // Unscheduled orders in this location (no assignment, not completed).
  const unscheduled = ds.orders.filter(
    (o) => o.locationId === locationId && o.status !== "Completed" && assignmentsFor(ds, o.id).length === 0 && matches(o),
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : "";
    if (!overId) return;

    // dropped back onto the drawer → unschedule (if it was placed)
    if (overId === "drawer") {
      if (activeId.startsWith("asg:")) unschedule(activeId.slice(4));
      return;
    }
    if (!overId.startsWith("cell:")) return;
    const [, laneId, date] = overId.split(":");
    const lane = ds.lanes.find((l) => l.id === laneId)!;

    const orderId = activeId.startsWith("order:") ? activeId.slice(6) : ds.assignments.find((a) => a.id === activeId.slice(4))?.orderId;
    const order = ds.orders.find((o) => o.id === orderId);
    if (!order) return;
    const item = itemFor(ds, order)!;

    const elig = isEligible(lane, item);
    if (!elig.ok) { toast("error", `Can't place ${order.productionNo}: ${elig.reason}`); return; }

    const ignoreId = activeId.startsWith("asg:") ? activeId.slice(4) : undefined;
    if (!orderFitsSingleDay(ds, laneId, date, item, order.qtyNeeded, ignoreId)) {
      toast("error", `${lane.code} on ${fmtShort(date)} would exceed its ${laneDayLoad(ds, laneId, date).capacity}h cap`);
      return;
    }

    if (activeId.startsWith("order:")) scheduleOrder(order.id, laneId, date);
    else moveAssignment(activeId.slice(4), laneId, date);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="toolbar">
        <div className="filters">
          <select className="chip-select" value={weekOffset} onChange={(e) => setWeekOffset(Number(e.target.value))}>
            <option value={0}>This week</option>
            <option value={1}>Next week</option>
            <option value={-1}>Last week</option>
          </select>
          <select className="chip-select" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            {["All", "Stock", "Customer", "eComm"].map((t) => <option key={t}>{t === "All" ? "All order types" : t}</option>)}
          </select>
          <select className="chip-select" value={filters.importance} onChange={(e) => setFilters({ ...filters, importance: e.target.value })}>
            {["All", "High", "Medium", "Low"].map((t) => <option key={t} value={t}>{t === "All" ? "All importance" : t}</option>)}
          </select>
          <select className="chip-select" value={filters.laneType} onChange={(e) => setFilters({ ...filters, laneType: e.target.value })}>
            {["All", "Round", "Flat", "Special"].map((t) => <option key={t} value={t}>{t === "All" ? "All tables" : `${t} only`}</option>)}
          </select>
          <input type="text" placeholder="Search production # or SKU" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        {canEdit && <button className="btn primary" onClick={() => setView("autoschedule")}>Run auto-scheduler</button>}
      </div>

      <div className={styles.layout}>
        <div className={styles.boardWrap}>
          <table className={styles.board}>
            <thead>
              <tr>
                <th className={styles.laneHead}>Lane · {ds.locations.find((l) => l.id === locationId)?.name}</th>
                {days.map((d) => <th key={d}>{fmtShort(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => (
                <tr key={lane.id}>
                  <td className={styles.laneCell}>
                    {lane.name}<br />
                    <span className={styles.cap}>{lane.defaultCapacityHrs} hr hard cap · {lane.type}</span>
                  </td>
                  {days.map((date) => (
                    <Cell key={date} lane={lane} date={date} canEdit={canEdit} today={today} />
                  ))}
                </tr>
              ))}
              {!lanes.length && (
                <tr><td colSpan={days.length + 1} className={styles.noLanes}>No lanes match this filter for {ds.locations.find((l) => l.id === locationId)?.name}.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <Drawer orders={unscheduled} canEdit={canEdit} today={today} />
      </div>

      <div className={styles.legend}>
        <span><span className={styles.dot} style={{ background: "var(--neutral)" }} />On-time</span>
        <span><span className={styles.dot} style={{ background: "var(--amber)" }} />At-risk</span>
        <span><span className={styles.dot} style={{ background: "var(--red)" }} />Late / blocked</span>
        <span className="muted">Bar = booked vs. hard hour capacity — the board refuses a drop past 100%.</span>
      </div>
      <div className="hint">Drag an order from the unscheduled panel onto a lane/day, or drag a placed block to reschedule. Lanes are this site's own table set (they aren't standardized across locations).</div>
    </DndContext>
  );
}

function Cell({ lane, date, canEdit, today }: { lane: Lane; date: string; canEdit: boolean; today: string }) {
  const ds = useAppStore((s) => s.ds);
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${lane.id}:${date}`, disabled: !canEdit });
  const load = laneDayLoad(ds, lane.id, date);
  const override = ds.laneDays.find((d) => d.laneId === lane.id && d.date === date);
  const cellAssignments = ds.assignments.filter((a) => a.laneId === lane.id && a.date === date);

  const pct = Math.min(100, Math.round(load.pct * 100));
  return (
    <td ref={setNodeRef} className={`${styles.dayCell} ${isOver ? styles.over : ""}`}>
      {override && <div className={`${styles.override} ${override.capacityHrs === 0 ? styles.down : ""}`}>{override.exception}: {override.capacityHrs}h</div>}
      {cellAssignments.map((a) => <Block key={a.id} assignment={a} canEdit={canEdit} today={today} />)}
      <div className={styles.capBar} title={`${fmtHrs(load.booked)} of ${fmtHrs(load.capacity)}`}>
        <div className={`${styles.capFill} ${load.over ? styles.capOver : ""}`} style={{ width: `${load.over ? 100 : pct}%` }} />
      </div>
    </td>
  );
}

function Block({ assignment, canEdit, today }: { assignment: ScheduleAssignment; canEdit: boolean; today: string }) {
  const ds = useAppStore((s) => s.ds);
  const order = ds.orders.find((o) => o.id === assignment.orderId)!;
  const item = itemFor(ds, order)!;
  const level = classifyRisk(order, assignmentsFor(ds, order.id), today);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `asg:${assignment.id}`, disabled: !canEdit });
  const riskClass = level === "at-risk" ? styles.risk : level === "late" ? styles.late : "";
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`${styles.block} ${riskClass} ${isDragging ? styles.dragging : ""}`}
      title={`${order.productionNo} · ${item.description} · ${fmtHrs(assignment.runHrs)}`}
    >
      <b>{order.productionNo}</b>
      <span>{order.orderType} · {order.importance} · {fmtHrs(assignment.runHrs)}</span>
    </div>
  );
}

function Drawer({ orders, canEdit, today }: { orders: Order[]; canEdit: boolean; today: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: "drawer" });
  return (
    <div ref={setNodeRef} className={`${styles.drawer} ${isOver ? styles.drawerOver : ""}`}>
      <div className={styles.drawerHead}>Unscheduled <span className="badge-count">{orders.length}</span></div>
      {orders.map((o) => <DrawerCard key={o.id} order={o} canEdit={canEdit} today={today} />)}
      {!orders.length && <div className={styles.drawerEmpty}>All orders placed 🎉</div>}
    </div>
  );
}

function DrawerCard({ order, canEdit, today }: { order: Order; canEdit: boolean; today: string }) {
  const ds = useAppStore((s) => s.ds);
  const item = itemFor(ds, order) as Item;
  const level = classifyRisk(order, [], today);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `order:${order.id}`, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`${styles.card} ${isDragging ? styles.dragging : ""}`}
    >
      <div className={styles.cardTop}>
        <b>{order.productionNo}</b>
        <span className={`tag ${RISK_TAG[level]}`}>{level}</span>
      </div>
      <div className={styles.cardMeta}>{item?.type} · {order.orderType} · qty {order.qtyNeeded}</div>
      <div className={styles.cardMeta}>needs by {fmtShort(order.neededBy)}</div>
    </div>
  );
}
