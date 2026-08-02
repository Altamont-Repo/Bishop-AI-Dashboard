import { create } from "zustand";
import type {
  AuditAction, AuditEntity, AuditEntry, CapacityException, Dataset, Item, Lane,
  Location, Order, OrderStatus, Role, ScheduleAssignment, User,
} from "../domain/types";
import type { ViewKey } from "../auth/permissions";
import { can } from "../auth/permissions";
import { repository } from "../data/memoryRepository";
import { estimatedRunTimeHrs, runOnlyHrs, setupHrs } from "../domain/runtime";
import { itemFor } from "../domain/capacity";
import { planFit, remainingQty } from "../domain/carryover";
import type { ProposalItem } from "../domain/scheduler";
import { newId, nowISO, toISO } from "../lib/util";

interface Toast { id: string; kind: "info" | "success" | "error"; msg: string; }

interface AppState {
  ds: Dataset;
  ready: boolean;

  // UI / session
  role: Role;
  currentUserName: string;
  locationId: string;
  view: ViewKey;
  today: string;
  toasts: Toast[];

  // lifecycle
  init: () => Promise<void>;

  // session setters
  setRole: (r: Role) => void;
  setLocation: (id: string) => void;
  setView: (v: ViewKey) => void;
  dismissToast: (id: string) => void;
  toast: (kind: Toast["kind"], msg: string) => void;

  // orders
  addOrder: (o: Omit<Order, "id" | "createdAt" | "updatedAt" | "qtyProduced" | "status" | "flagged">) => void;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  deleteOrder: (id: string) => void;
  pasteOrders: (rows: PastedOrder[]) => number;
  toggleFlag: (id: string, reason?: string) => void;

  // scheduling
  scheduleOrder: (orderId: string, laneId: string, date: string) => void;
  moveAssignment: (assignmentId: string, laneId: string, date: string) => void;
  unschedule: (assignmentId: string) => void;
  splitOrder: (orderId: string, parts: { laneId: string; date: string; qty: number }[]) => void;
  applyProposal: (items: ProposalItem[]) => number;
  applyBatch: (orderIds: string[], laneId: string, date: string) => number;

  // status / production
  setStatus: (orderId: string, status: OrderStatus) => void;
  recordProduced: (orderId: string, qtyProduced: number) => void;
  carryOver: (orderId: string) => number;

  // masters
  addItem: (i: Omit<Item, "id">) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  bulkImportItems: (list: Omit<Item, "id">[]) => number;

  addLane: (l: Omit<Lane, "id">) => void;
  updateLane: (id: string, patch: Partial<Lane>) => void;
  deleteLane: (id: string) => void;
  setLaneDay: (laneId: string, date: string, capacityHrs: number, exception?: CapacityException, note?: string) => void;
  applyRangeOverride: (laneId: string, dates: string[], capacityHrs: number, exception?: CapacityException) => void;

  addLocation: (l: Omit<Location, "id">) => void;
  updateLocation: (id: string, patch: Partial<Location>) => void;

  addUser: (u: Omit<User, "id">) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
}

export interface PastedOrder {
  productionNo: string; itemNumber: string; qtyNeeded: number;
  orderType: Order["orderType"]; importance: Order["importance"]; neededBy: string; value: number;
}

const audit = (
  ds: Dataset, userName: string, action: AuditAction, entity: AuditEntity,
  entityRef: string, summary: string,
): AuditEntry[] => [
  { id: newId("aud"), at: nowISO(), userName, action, entity, entityRef, summary },
  ...ds.audit,
];

export const useAppStore = create<AppState>((set, get) => {
  /** Apply a mutation to the dataset + append one audit entry, then toast. */
  const commit = (
    mutate: (ds: Dataset) => { ds: Partial<Dataset>; ref: string; summary: string; action: AuditAction; entity: AuditEntity },
    toastMsg?: string,
  ) => {
    const state = get();
    const draft: Dataset = {
      ...state.ds,
      locations: [...state.ds.locations],
      lanes: [...state.ds.lanes],
      laneDays: [...state.ds.laneDays],
      items: [...state.ds.items],
      orders: [...state.ds.orders],
      assignments: [...state.ds.assignments],
      users: [...state.ds.users],
      audit: state.ds.audit,
    };
    const { ds: patch, ref, summary, action, entity } = mutate(draft);
    const next: Dataset = { ...draft, ...patch };
    next.audit = audit(next, state.currentUserName, action, entity, ref, summary);
    void repository.save(next);
    set({ ds: next });
    if (toastMsg) get().toast("success", toastMsg);
  };

  /** Recompute an order's status from its assignments + production. */
  const deriveStatus = (order: Order, assignments: ScheduleAssignment[]): OrderStatus => {
    if (order.qtyProduced >= order.qtyNeeded && order.qtyNeeded > 0) return "Completed";
    if (order.qtyProduced > 0) return "WIP";
    const has = assignments.some((a) => a.orderId === order.id);
    return has ? "Scheduled" : "Pending";
  };

  return {
    ds: {
      locations: [], lanes: [], laneDays: [], items: [],
      orders: [], assignments: [], users: [], audit: [],
    },
    ready: false,
    role: "Production Planner",
    currentUserName: "J. Patel",
    locationId: "loc_houston",
    view: "board",
    today: toISO(new Date()),
    toasts: [],

    init: async () => {
      const ds = await repository.load();
      set({ ds, ready: true, locationId: ds.locations[0]?.id ?? "" });
    },

    setRole: (role) => {
      const user = get().ds.users.find((u) => u.role === role);
      set({ role, currentUserName: user?.name ?? role, view: can(role).landing });
    },
    setLocation: (locationId) => set({ locationId }),
    setView: (view) => set({ view }),

    toast: (kind, msg) => {
      const id = newId("t");
      set((s) => ({ toasts: [...s.toasts, { id, kind, msg }] }));
      setTimeout(() => get().dismissToast(id), 3200);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    // ---------------- orders ----------------
    addOrder: (o) => commit((ds) => {
      const order: Order = {
        ...o, id: newId("order"), qtyProduced: 0, status: "Pending", flagged: false,
        createdAt: nowISO(), updatedAt: nowISO(),
      };
      ds.orders = [order, ...ds.orders];
      return { ds: { orders: ds.orders }, ref: order.productionNo, action: "create", entity: "order", summary: `created order ${order.productionNo}` };
    }, "Order created — logged to audit"),

    updateOrder: (id, patch) => commit((ds) => {
      ds.orders = ds.orders.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: nowISO() } : o));
      const o = ds.orders.find((x) => x.id === id)!;
      return { ds: { orders: ds.orders }, ref: o.productionNo, action: "update", entity: "order", summary: `updated order ${o.productionNo}` };
    }, "Order updated"),

    deleteOrder: (id) => commit((ds) => {
      const o = ds.orders.find((x) => x.id === id)!;
      ds.orders = ds.orders.filter((x) => x.id !== id);
      ds.assignments = ds.assignments.filter((a) => a.orderId !== id);
      return { ds: { orders: ds.orders, assignments: ds.assignments }, ref: o.productionNo, action: "delete", entity: "order", summary: `deleted order ${o.productionNo}` };
    }, "Order deleted"),

    pasteOrders: (rows) => {
      const { locationId } = get();
      let count = 0;
      rows.forEach((r) => {
        get().addOrder({ ...r, locationId });
        count += 1;
      });
      if (count) get().toast("success", `Pasted ${count} order${count === 1 ? "" : "s"}`);
      return count;
    },

    toggleFlag: (id, reason) => commit((ds) => {
      ds.orders = ds.orders.map((o) => (o.id === id ? { ...o, flagged: !o.flagged, flagReason: !o.flagged ? reason : undefined, updatedAt: nowISO() } : o));
      const o = ds.orders.find((x) => x.id === id)!;
      return { ds: { orders: ds.orders }, ref: o.productionNo, action: "update", entity: "order", summary: `${o.flagged ? "flagged" : "unflagged"} ${o.productionNo}` };
    }),

    // ---------------- scheduling ----------------
    scheduleOrder: (orderId, laneId, date) => commit((ds) => {
      const o = ds.orders.find((x) => x.id === orderId)!;
      const item = itemFor(ds, o)!;
      const asg: ScheduleAssignment = {
        id: newId("asg"), orderId, laneId, date, qty: remainingQty(o) || o.qtyNeeded,
        runHrs: estimatedRunTimeHrs(item, remainingQty(o) || o.qtyNeeded), locked: true,
      };
      ds.assignments = [...ds.assignments, asg];
      ds.orders = ds.orders.map((x) => (x.id === orderId ? { ...x, status: deriveStatus(x, ds.assignments), updatedAt: nowISO() } : x));
      return { ds: { assignments: ds.assignments, orders: ds.orders }, ref: o.productionNo, action: "update", entity: "assignment", summary: `scheduled ${o.productionNo}` };
    }, "Order scheduled"),

    moveAssignment: (assignmentId, laneId, date) => commit((ds) => {
      ds.assignments = ds.assignments.map((a) => (a.id === assignmentId ? { ...a, laneId, date, locked: true } : a));
      const a = ds.assignments.find((x) => x.id === assignmentId)!;
      const o = ds.orders.find((x) => x.id === a.orderId)!;
      return { ds: { assignments: ds.assignments }, ref: o.productionNo, action: "update", entity: "assignment", summary: `rescheduled ${o.productionNo}` };
    }, "Rescheduled"),

    unschedule: (assignmentId) => commit((ds) => {
      const a = ds.assignments.find((x) => x.id === assignmentId)!;
      const o = ds.orders.find((x) => x.id === a.orderId)!;
      ds.assignments = ds.assignments.filter((x) => x.id !== assignmentId);
      ds.orders = ds.orders.map((x) => (x.id === o.id ? { ...x, status: deriveStatus(x, ds.assignments), updatedAt: nowISO() } : x));
      return { ds: { assignments: ds.assignments, orders: ds.orders }, ref: o.productionNo, action: "update", entity: "assignment", summary: `unscheduled ${o.productionNo}` };
    }, "Removed from board"),

    splitOrder: (orderId, parts) => commit((ds) => {
      const o = ds.orders.find((x) => x.id === orderId)!;
      const item = itemFor(ds, o)!;
      const created = parts
        .filter((p) => p.qty > 0)
        .map<ScheduleAssignment>((p) => ({
          id: newId("asg"), orderId, laneId: p.laneId, date: p.date, qty: p.qty,
          runHrs: estimatedRunTimeHrs(item, p.qty), locked: true,
        }));
      // replace this order's existing assignments with the split
      ds.assignments = [...ds.assignments.filter((a) => a.orderId !== orderId), ...created];
      ds.orders = ds.orders.map((x) => (x.id === orderId ? { ...x, status: deriveStatus(x, ds.assignments), updatedAt: nowISO() } : x));
      return { ds: { assignments: ds.assignments, orders: ds.orders }, ref: o.productionNo, action: "update", entity: "assignment", summary: `split ${o.productionNo} into ${created.length} segments` };
    }, "Order split across lane-days"),

    applyProposal: (items) => {
      const placed = items.filter((i) => i.placed && i.laneId && i.date);
      if (!placed.length) { get().toast("info", "No placements selected to apply."); return 0; }
      commit((ds) => {
        // Auto-placed: re-runnable, not a manual lock. Split orders yield one
        // assignment per segment; whole-order placements yield one.
        const created = placed.flatMap<ScheduleAssignment>((i) =>
          (i.segments && i.segments.length
            ? i.segments.map((s) => ({ id: newId("asg"), orderId: i.orderId, laneId: s.laneId, date: s.date, qty: s.qty, runHrs: s.runHrs, locked: false }))
            : [{ id: newId("asg"), orderId: i.orderId, laneId: i.laneId!, date: i.date!, qty: i.qty, runHrs: i.runHrs ?? 0, locked: false }]),
        );
        ds.assignments = [...ds.assignments, ...created];
        const placedIds = new Set(placed.map((i) => i.orderId));
        ds.orders = ds.orders.map((o) => (placedIds.has(o.id) ? { ...o, status: deriveStatus(o, ds.assignments), updatedAt: nowISO() } : o));
        return { ds: { assignments: ds.assignments, orders: ds.orders }, ref: `${placed.length} orders`, action: "create", entity: "assignment", summary: `auto-scheduler placed ${placed.length} orders` };
      });
      get().toast("success", `Committed ${placed.length} placement${placed.length === 1 ? "" : "s"} to the board`);
      return placed.length;
    },

    applyBatch: (orderIds, laneId, date) => {
      if (orderIds.length < 2) return 0;
      commit((ds) => {
        // Batch onto one lane-day sharing a single setup: the first order carries
        // setup + its run, the rest carry run-only — so booked hours reflect the
        // saved setup (matches the scheduler's batching model).
        const created = orderIds.map<ScheduleAssignment>((oid, idx) => {
          const o = ds.orders.find((x) => x.id === oid)!;
          const item = itemFor(ds, o)!;
          const runHrs = (idx === 0 ? setupHrs(item) : 0) + runOnlyHrs(item, o.qtyNeeded);
          return { id: newId("asg"), orderId: oid, laneId, date, qty: o.qtyNeeded, runHrs, locked: true };
        });
        ds.assignments = [...ds.assignments, ...created];
        const ids = new Set(orderIds);
        ds.orders = ds.orders.map((o) => (ids.has(o.id) ? { ...o, status: deriveStatus(o, ds.assignments), updatedAt: nowISO() } : o));
        const lane = ds.lanes.find((l) => l.id === laneId);
        return { ds: { assignments: ds.assignments, orders: ds.orders }, ref: `${orderIds.length} orders`, action: "create", entity: "assignment", summary: `batched ${orderIds.length} orders onto ${lane?.code ?? "lane"}` };
      });
      get().toast("success", `Batched ${orderIds.length} orders — one shared setup`);
      return orderIds.length;
    },

    // ---------------- status / production ----------------
    setStatus: (orderId, status) => commit((ds) => {
      ds.orders = ds.orders.map((o) => (o.id === orderId ? {
        ...o, status,
        qtyProduced: status === "Completed" ? o.qtyNeeded : o.qtyProduced,
        updatedAt: nowISO(),
      } : o));
      const o = ds.orders.find((x) => x.id === orderId)!;
      return { ds: { orders: ds.orders }, ref: o.productionNo, action: "update", entity: "order", summary: `status → ${status} for ${o.productionNo}` };
    }, "Status updated"),

    recordProduced: (orderId, qtyProduced) => commit((ds) => {
      ds.orders = ds.orders.map((o) => {
        if (o.id !== orderId) return o;
        const qp = Math.max(0, Math.min(qtyProduced, o.qtyNeeded));
        const status: OrderStatus = qp >= o.qtyNeeded ? "Completed" : qp > 0 ? "WIP" : deriveStatus(o, ds.assignments);
        return { ...o, qtyProduced: qp, status, updatedAt: nowISO() };
      });
      const o = ds.orders.find((x) => x.id === orderId)!;
      return { ds: { orders: ds.orders }, ref: o.productionNo, action: "update", entity: "order", summary: `recorded ${o.qtyProduced}/${o.qtyNeeded} for ${o.productionNo}` };
    }, "Production recorded"),

    carryOver: (orderId) => {
      const { ds } = get();
      const o = ds.orders.find((x) => x.id === orderId);
      if (!o) return 0;
      const rem = remainingQty(o);
      if (rem <= 0) { get().toast("info", "Nothing to carry over — order fully produced."); return 0; }
      const item = itemFor(ds, o);
      if (!item) return 0;
      const lastDate = ds.assignments.filter((a) => a.orderId === orderId).reduce((m, a) => (a.date > m ? a.date : m), get().today);
      const laneId = ds.assignments.find((a) => a.orderId === orderId)?.laneId
        ?? ds.lanes.find((l) => l.locationId === o.locationId && l.type === item.type)?.id;
      if (!laneId) { get().toast("error", "No eligible lane for carry-over."); return 0; }
      const segs = planFit(ds, laneId, item, rem, lastDate);
      if (!segs.length) { get().toast("error", "No capacity in horizon for carry-over."); return 0; }
      commit((d) => {
        const created = segs.map<ScheduleAssignment>((s) => ({ id: newId("asg"), orderId, laneId: s.laneId, date: s.date, qty: s.qty, runHrs: s.runHrs, locked: false }));
        d.assignments = [...d.assignments, ...created];
        return { ds: { assignments: d.assignments }, ref: o.productionNo, action: "create", entity: "assignment", summary: `carried over ${rem} units of ${o.productionNo}` };
      });
      get().toast("success", `Carried over ${rem} units across ${segs.length} day${segs.length === 1 ? "" : "s"}`);
      return segs.reduce((n, s) => n + s.qty, 0);
    },

    // ---------------- masters ----------------
    addItem: (i) => commit((ds) => {
      const it: Item = { ...i, id: newId("item") };
      ds.items = [it, ...ds.items];
      return { ds: { items: ds.items }, ref: it.itemNumber, action: "create", entity: "item", summary: `created item ${it.itemNumber}` };
    }, "Item created"),
    updateItem: (id, patch) => commit((ds) => {
      ds.items = ds.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
      const it = ds.items.find((x) => x.id === id)!;
      return { ds: { items: ds.items }, ref: it.itemNumber, action: "update", entity: "item", summary: `updated item ${it.itemNumber}` };
    }, "Item saved"),
    deleteItem: (id) => commit((ds) => {
      const it = ds.items.find((x) => x.id === id)!;
      ds.items = ds.items.filter((x) => x.id !== id);
      return { ds: { items: ds.items }, ref: it.itemNumber, action: "delete", entity: "item", summary: `deleted item ${it.itemNumber}` };
    }, "Item deleted"),
    bulkImportItems: (list) => {
      list.forEach((i) => get().addItem(i));
      if (list.length) get().toast("success", `Imported ${list.length} items`);
      return list.length;
    },

    addLane: (l) => commit((ds) => {
      const lane: Lane = { ...l, id: newId("lane") };
      ds.lanes = [...ds.lanes, lane];
      return { ds: { lanes: ds.lanes }, ref: lane.code, action: "create", entity: "lane", summary: `created lane ${lane.code}` };
    }, "Lane created"),
    updateLane: (id, patch) => commit((ds) => {
      ds.lanes = ds.lanes.map((l) => (l.id === id ? { ...l, ...patch } : l));
      const l = ds.lanes.find((x) => x.id === id)!;
      return { ds: { lanes: ds.lanes }, ref: l.code, action: "update", entity: "lane", summary: `updated lane ${l.code}` };
    }, "Lane saved"),
    deleteLane: (id) => commit((ds) => {
      const l = ds.lanes.find((x) => x.id === id)!;
      ds.lanes = ds.lanes.filter((x) => x.id !== id);
      ds.assignments = ds.assignments.filter((a) => a.laneId !== id);
      ds.laneDays = ds.laneDays.filter((d) => d.laneId !== id);
      return { ds: { lanes: ds.lanes, assignments: ds.assignments, laneDays: ds.laneDays }, ref: l.code, action: "delete", entity: "lane", summary: `deleted lane ${l.code}` };
    }, "Lane deleted"),
    setLaneDay: (laneId, date, capacityHrs, exception, note) => commit((ds) => {
      const existing = ds.laneDays.find((d) => d.laneId === laneId && d.date === date);
      if (existing) {
        ds.laneDays = ds.laneDays.map((d) => (d === existing ? { ...d, capacityHrs, exception, note } : d));
      } else {
        ds.laneDays = [...ds.laneDays, { id: newId("ld"), laneId, date, capacityHrs, exception, note }];
      }
      return { ds: { laneDays: ds.laneDays }, ref: date, action: "update", entity: "laneDay", summary: `capacity ${capacityHrs}h on ${date}` };
    }, "Capacity override saved"),
    applyRangeOverride: (laneId, dates, capacityHrs, exception) => commit((ds) => {
      let laneDays = [...ds.laneDays];
      dates.forEach((date) => {
        laneDays = laneDays.filter((d) => !(d.laneId === laneId && d.date === date));
        laneDays.push({ id: newId("ld"), laneId, date, capacityHrs, exception });
      });
      ds.laneDays = laneDays;
      return { ds: { laneDays }, ref: `${dates.length} days`, action: "update", entity: "laneDay", summary: `range override ${capacityHrs}h over ${dates.length} days` };
    }, "Range override applied"),

    addLocation: (l) => commit((ds) => {
      const loc: Location = { ...l, id: newId("loc") };
      ds.locations = [...ds.locations, loc];
      return { ds: { locations: ds.locations }, ref: loc.name, action: "create", entity: "location", summary: `created location ${loc.name}` };
    }, "Location created"),
    updateLocation: (id, patch) => commit((ds) => {
      ds.locations = ds.locations.map((l) => (l.id === id ? { ...l, ...patch } : l));
      const l = ds.locations.find((x) => x.id === id)!;
      return { ds: { locations: ds.locations }, ref: l.name, action: "update", entity: "location", summary: `updated location ${l.name}` };
    }, "Location saved"),

    addUser: (u) => commit((ds) => {
      const user: User = { ...u, id: newId("user") };
      ds.users = [...ds.users, user];
      return { ds: { users: ds.users }, ref: user.name, action: "create", entity: "user", summary: `invited user ${user.name}` };
    }, "User invited"),
    updateUser: (id, patch) => commit((ds) => {
      ds.users = ds.users.map((u) => (u.id === id ? { ...u, ...patch } : u));
      const u = ds.users.find((x) => x.id === id)!;
      return { ds: { users: ds.users }, ref: u.name, action: "update", entity: "user", summary: `updated user ${u.name}` };
    }, "User saved"),
  };
});
