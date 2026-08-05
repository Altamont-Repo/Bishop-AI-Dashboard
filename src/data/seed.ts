import { addDays, startOfWeek } from "date-fns";
import type {
  Dataset, Item, Lane, Location, Order, ScheduleAssignment, User,
} from "../domain/types";
import { estimatedRunTimeHrs } from "../domain/runtime";
import { newId, toISO } from "../lib/util";

// Anchor the seed to the current work-week so the board always looks live.
const MONDAY = startOfWeek(new Date(), { weekStartsOn: 1 });
const day = (offset: number): string => toISO(addDays(MONDAY, offset));
const MON = day(0), TUE = day(1), WED = day(2), THU = day(3), FRI = day(4);
const LAST_MON = day(-7);

// ---------------------------------------------------------------------------
// Locations (wireframe Locations screen)
// ---------------------------------------------------------------------------
const houston: Location = { id: "loc_houston", name: "Houston", address: "4210 Rigging Way", city: "Houston", state: "TX", zip: "77040" };
const hurst: Location = { id: "loc_hurst", name: "Hurst", address: "—", city: "Hurst", state: "TX", zip: "—" };
const casselberry: Location = { id: "loc_cass", name: "Casselberry", address: "—", city: "Casselberry", state: "FL", zip: "—" };
const milwaukee: Location = { id: "loc_milw", name: "Milwaukee", address: "—", city: "Milwaukee", state: "WI", zip: "—" };
const lafayette: Location = { id: "loc_laf", name: "Lafayette", address: "—", city: "Lafayette", state: "LA", zip: "—" };
const locations = [houston, hurst, casselberry, milwaukee, lafayette];

// ---------------------------------------------------------------------------
// Lanes (wireframe Lane master — custom per location; Milwaukee has no Round)
// ---------------------------------------------------------------------------
function lane(locationId: string, code: string, name: string, types: Lane["types"], cap: number, skillTags: string[] = [], overtimeHrs = 0.5): Lane {
  return { id: `lane_${locationId}_${code}`, locationId, code, name, types, defaultCapacityHrs: cap, overtimeHrs, shiftsPerDay: 1, skillTags };
}
const lanes: Lane[] = [
  // Houston — 4 tables (1 Round, 1 Flat/Round combo, 2 Special)
  lane(houston.id, "R-01", "Round Sling Table 1", ["Round"], 8),
  lane(houston.id, "F-01", "Flat Web Table 1", ["Flat", "Round"], 8),
  lane(houston.id, "SP-01", "Special Table 1", ["Special"], 6, ["rig-cert"]),
  lane(houston.id, "SP-02", "Special Table 2", ["Special", "Flat"], 6, ["rig-cert"]),
  // Hurst — 3 tables
  lane(hurst.id, "R-01", "Round Sling Table 1", ["Round"], 8),
  lane(hurst.id, "F-01", "Flat Web Table 1", ["Flat"], 8),
  lane(hurst.id, "SP-01", "Special Table 1", ["Special"], 6),
  // Casselberry — 2 tables
  lane(casselberry.id, "R-01", "Round Sling Table 1", ["Round"], 8),
  lane(casselberry.id, "F-01", "Flat Web Table 1", ["Flat"], 8),
  // Milwaukee — 2 tables, NO Round
  lane(milwaukee.id, "F-01", "Flat Web Table 1", ["Flat"], 8),
  lane(milwaukee.id, "SP-01", "Special Table 1", ["Special"], 6),
  // Lafayette — 2 Flat tables
  lane(lafayette.id, "F-01", "Flat Web Table 1", ["Flat"], 8),
  lane(lafayette.id, "F-02", "Flat Web Table 2", ["Flat"], 8),
];
const HL = (code: string) => lanes.find((l) => l.locationId === "loc_houston" && l.code === code)!.id;
const HURSTL = (code: string) => lanes.find((l) => l.locationId === "loc_hurst" && l.code === code)!.id;

// ---------------------------------------------------------------------------
// Items — actual order SKUs (from Production Master + Product Mappings) plus
// a few descriptive catalog items (from the wireframe Item master).
// prod/setup times are in MINUTES (per the Excel).
// ---------------------------------------------------------------------------
function item(itemNumber: string, description: string, type: Item["type"], perUnit: number, setup: number, price: number, hardware = false, reqs: string[] = []): Item {
  return { id: `item_${itemNumber}`, itemNumber, description, type, prodTimePerUnitMins: perUnit, setupTimeMins: setup, listPrice: price, hardwareNeeded: hardware, specialReqs: reqs };
}
const items: Item[] = [
  item("TFG07X020", 'Round sling 7/8" x 20\'', "Round", 5, 15, 400, true),
  item("EEF3904P06", 'Flat web sling 3" x 6\'', "Flat", 5, 15, 320),
  item("EEF3904P10", 'Flat web sling 3" x 10\'', "Flat", 5, 15, 380),
  item("TF-FG09X020", 'Round sling 1" x 20\'', "Round", 10, 20, 520, true),
  item("TF-FG03X010", 'Round sling 1/2" x 10\'', "Round", 7, 10, 280),
  item("SP-1", "Special rigging assembly", "Special", 40, 20, 500, true),
  // Catalog items available for new orders
  item("RS-1206", 'Round sling 1/2" x 6\'', "Round", 9, 30, 84),
  item("RS-0812", 'Round sling 3/4" x 12\'', "Round", 13, 30, 142, true),
  item("FS-2010", 'Flat sling 2" x 10\'', "Flat", 11, 36, 110),
  item("SP-4400", "Rigging cert assembly", "Special", 54, 60, 520, true, ["rig-cert"]),
];
const itemBy = (n: string) => items.find((i) => i.itemNumber === n)!;

// ---------------------------------------------------------------------------
// Orders (wireframe Orders table + Production Master), need-by dates spread so
// the risk engine produces on-time / at-risk / late without hand-set flags.
// ---------------------------------------------------------------------------
let orderSeq = 0;
function order(
  productionNo: string, locationId: string, itemNumber: string, qty: number,
  orderType: Order["orderType"], importance: Order["importance"], neededBy: string,
  value: number, status: Order["status"], qtyProduced = 0,
): Order {
  orderSeq += 1;
  const ts = new Date(Date.now() - orderSeq * 3600_000).toISOString();
  return {
    id: `order_${productionNo}`, locationId, productionNo, itemNumber, qtyNeeded: qty,
    qtyProduced, orderType, importance, neededBy, value, status,
    flagged: false, createdAt: ts, updatedAt: ts,
  };
}
const orders: Order[] = [
  order("RS-0001", "loc_hurst", "TFG07X020", 100, "Customer", "High", LAST_MON, 40000, "Completed", 100),
  order("FW-0001", "loc_houston", "EEF3904P06", 70, "Stock", "High", FRI, 40000, "Scheduled"),
  order("FW-0002", "loc_houston", "EEF3904P10", 50, "eComm", "Medium", WED, 30000, "Scheduled"),
  order("SP-0001", "loc_houston", "SP-1", 4, "Customer", "Low", day(2), 2000, "Pending"),
  order("RS-0002", "loc_hurst", "TF-FG09X020", 25, "Stock", "Medium", day(-1), 40000, "Pending"),
  order("RS-0003", "loc_houston", "TF-FG03X010", 50, "Customer", "Medium", day(9), 25000, "Pending"),
  // Extra completed/scheduled orders so dashboards are populated
  order("FW-0004", "loc_houston", "EEF3904P10", 20, "eComm", "Low", MON, 8000, "Completed", 20),
  order("RS-0010", "loc_houston", "TF-FG03X010", 30, "Stock", "Medium", TUE, 15000, "Completed", 30),
  order("FW-0003", "loc_houston", "EEF3904P06", 40, "Stock", "Medium", WED, 18000, "Completed", 40),
  order("SP-0002", "loc_houston", "SP-1", 6, "Customer", "High", THU, 6000, "Scheduled"),
  // Unscheduled same-item clusters at Houston to demonstrate batching.
  order("RS-0004", "loc_houston", "TFG07X020", 30, "Customer", "Medium", day(8), 14000, "Pending"),
  order("RS-0005", "loc_houston", "TFG07X020", 20, "Stock", "Low", day(9), 9000, "Pending"),
  order("RS-0006", "loc_houston", "TFG07X020", 15, "Customer", "Medium", day(10), 7000, "Pending"),
  order("FW-0005", "loc_houston", "FS-2010", 15, "Customer", "High", day(8), 11000, "Pending"),
  order("FW-0006", "loc_houston", "FS-2010", 20, "Stock", "Medium", day(9), 12000, "Pending"),
];
const orderBy = (n: string) => orders.find((o) => o.productionNo === n)!;

// ---------------------------------------------------------------------------
// Schedule assignments (pre-placed work on the Houston board this week)
// ---------------------------------------------------------------------------
function assign(productionNo: string, laneId: string, date: string, locked = false): ScheduleAssignment {
  const o = orderBy(productionNo);
  const it = itemBy(o.itemNumber);
  return {
    id: newId("asg"), orderId: o.id, laneId, date, qty: o.qtyNeeded,
    runHrs: estimatedRunTimeHrs(it, o.qtyNeeded), locked,
  };
}
const assignments: ScheduleAssignment[] = [
  assign("RS-0001", HURSTL("R-01"), LAST_MON, true),
  assign("FW-0001", HL("F-01"), MON),
  assign("FW-0002", HL("F-01"), TUE),
  assign("FW-0004", HL("F-01"), MON),
  assign("RS-0010", HL("R-01"), TUE),
  assign("FW-0003", HL("F-01"), WED),
  assign("SP-0002", HL("SP-01"), THU),
];

// ---------------------------------------------------------------------------
// Users (wireframe Admin screen)
// ---------------------------------------------------------------------------
const users: User[] = [
  { id: "user_jp", name: "Gaurav Malhotra", role: "Production Planner", locationScope: ["loc_houston"], active: true },
  { id: "user_ma", name: "M. Alvarez", role: "Shift Operator", locationScope: ["loc_houston"], active: true },
  { id: "user_do", name: "D. Osei", role: "Plant Manager", locationScope: ["loc_houston"], active: true },
  { id: "user_ar", name: "A. Reyes", role: "Admin", locationScope: [], active: true },
];

export function buildSeed(): Dataset {
  // reset per-build sequence so a reload produces identical ids
  orderSeq = 0;
  return {
    locations: structuredClone(locations),
    lanes: structuredClone(lanes),
    laneDays: [
      { id: newId("ld"), laneId: HL("F-01"), date: FRI, capacityHrs: 4, exception: "Holiday", note: "Half-day" },
      { id: newId("ld"), laneId: HL("SP-01"), date: WED, capacityHrs: 0, exception: "Maintenance", note: "Table down" },
    ],
    items: structuredClone(items),
    orders: structuredClone(orders),
    assignments: structuredClone(assignments),
    users: structuredClone(users),
    audit: [],
  };
}
