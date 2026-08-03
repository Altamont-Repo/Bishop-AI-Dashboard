import type { Role } from "../domain/types";

/** View keys — one per screen in the sidebar. */
export type ViewKey =
  | "board" | "autoschedule" | "batching"
  | "orders" | "status"
  | "dashboards"
  | "items" | "lanes" | "locations" | "admin";

export interface Capabilities {
  /** Views this role may open. */
  views: ViewKey[];
  /** Landing view when this role is selected (mirrors wireframe role-switch). */
  landing: ViewKey;
  editOrders: boolean;      // create / edit / reschedule / split
  runScheduler: boolean;    // (deferred feature, gated anyway)
  updateStatus: boolean;    // advance status / log qty produced
  overrideCapacity: boolean;
  editMasters: boolean;     // items / lanes / locations
  manageUsers: boolean;
}

const ALL_VIEWS: ViewKey[] = [
  "board", "autoschedule", "batching", "orders", "status",
  "dashboards", "items", "lanes", "locations", "admin",
];

/** BRD §4 role/permission matrix. Admin is a superset. */
export const CAPABILITIES: Record<Role, Capabilities> = {
  "Production Planner": {
    views: ["board", "autoschedule", "batching", "orders", "status", "dashboards", "items", "lanes"],
    landing: "board",
    editOrders: true,
    runScheduler: true,
    updateStatus: true,
    overrideCapacity: true, // planner manages per-day lane capacity
    editMasters: true,      // planner maintains item & lane masters (items CRUD, capacity calendar)
    manageUsers: false,
  },
  "Shift Operator": {
    views: ["status", "board", "orders"],
    landing: "status",
    editOrders: false,      // read-only on masters & orders
    runScheduler: false,
    updateStatus: true,     // may advance status + record qty produced
    overrideCapacity: false,
    editMasters: false,
    manageUsers: false,
  },
  "Plant Manager": {
    views: ["board", "autoschedule", "batching", "orders", "status", "dashboards", "items", "lanes", "locations"],
    landing: "dashboards",
    editOrders: true,
    runScheduler: true,
    updateStatus: true,
    overrideCapacity: true, // manager-only
    editMasters: true,
    manageUsers: false,
  },
  Admin: {
    views: ALL_VIEWS,
    landing: "admin",
    editOrders: true,
    runScheduler: true,
    updateStatus: true,
    overrideCapacity: true,
    editMasters: true,
    manageUsers: true,
  },
};

export function can(role: Role): Capabilities {
  return CAPABILITIES[role];
}
