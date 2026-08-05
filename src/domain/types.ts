// ---------------------------------------------------------------------------
// Bishop Synthetics Production Planning — domain model
// Mirrors BRD §7 data model. All ids are opaque strings so a future Supabase
// backend (uuid/pk) can drop in without touching callers.
// ---------------------------------------------------------------------------

export type ItemType = "Round" | "Flat" | "Special";
export type LaneType = ItemType; // a lane can serve one or more item types
export type OrderType = "Stock" | "Customer" | "eComm";
export type Importance = "High" | "Medium" | "Low";
export type OrderStatus = "Pending" | "Scheduled" | "WIP" | "Completed";
export type Role = "Production Planner" | "Shift Operator" | "Plant Manager" | "Admin";

/** Reason a capacity day differs from the lane default. */
export type CapacityException = "PTO" | "Maintenance" | "Holiday" | "Overtime";

export interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface Lane {
  id: string;
  locationId: string;
  code: string;           // e.g. "R-01"
  name: string;           // e.g. "Round Sling Table 1"
  types: LaneType[];      // item types this lane can run (multi-functional)
  defaultCapacityHrs: number; // hard cap, hours/day (already × shifts)
  overtimeHrs: number;    // extra hours allowed beyond the hard cap on a normal day
  shiftsPerDay: number;
  skillTags: string[];    // matched against item.specialReqs
}

/** Per-lane, per-day capacity — defaults to the lane's standard unless overridden. */
export interface LaneDayCapacity {
  id: string;
  laneId: string;
  date: string;           // ISO yyyy-mm-dd
  capacityHrs: number;
  exception?: CapacityException;
  note?: string;
}

export interface Item {
  id: string;
  itemNumber: string;     // unique key (SKU)
  description: string;
  type: ItemType;
  prodTimePerUnitMins: number; // "Target Per Unit Time"
  setupTimeMins: number;       // per run/batch
  listPrice: number;
  hardwareNeeded: boolean;
  specialReqs: string[];  // tags → lane skill match
}

export interface Order {
  id: string;
  locationId: string;
  productionNo: string;   // e.g. "RS-0001"
  itemNumber: string;     // → Item.itemNumber
  qtyNeeded: number;
  qtyProduced: number;
  orderType: OrderType;
  importance: Importance;
  neededBy: string;       // ISO date — primary scheduling driver
  value: number;          // order value ($)
  status: OrderStatus;
  flagged: boolean;
  flagReason?: string;
  autoFlagged?: boolean;  // set by risk engine (distinct from manual flag)
  riskAck?: boolean;      // planner dismissed the computed at-risk/late indicator
  createdAt: string;
  updatedAt: string;
}

/** An order (or split of it) placed on a specific lane/day. */
export interface ScheduleAssignment {
  id: string;
  orderId: string;
  laneId: string;
  date: string;           // ISO date
  qty: number;            // qty of the order on this lane-day (supports split)
  runHrs: number;         // computed run+setup hours this segment consumes
  locked: boolean;        // manual override preserved across future auto-runs
}

export interface User {
  id: string;
  name: string;
  role: Role;
  locationScope: string[]; // location ids the user can see ([] = all)
  active: boolean;
}

export type AuditAction = "create" | "update" | "delete";
export type AuditEntity =
  | "order" | "assignment" | "item" | "lane" | "laneDay" | "location" | "user";

export interface AuditEntry {
  id: string;
  at: string;             // ISO timestamp
  userName: string;
  action: AuditAction;
  entity: AuditEntity;
  entityRef: string;      // human-readable id (productionNo, item#, etc.)
  summary: string;
}

/** The full in-memory dataset. Supabase will later hydrate the same shape. */
export interface Dataset {
  locations: Location[];
  lanes: Lane[];
  laneDays: LaneDayCapacity[];
  items: Item[];
  orders: Order[];
  assignments: ScheduleAssignment[];
  users: User[];
  audit: AuditEntry[];
}
