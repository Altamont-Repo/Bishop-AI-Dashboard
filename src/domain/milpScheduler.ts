import { addDays, differenceInCalendarDays, isWeekend } from "date-fns";
import type { Dataset, Importance, Item, Order, OrderType } from "./types";
import { bookedHrs, dayCapacityHrs, isEligible, itemFor } from "./capacity";
import { runAutoSchedule, riskFor, type Proposal, type ProposalItem, type PlacementSegment } from "./scheduler";
import type { RiskLevel } from "./risk";
import { fromISO, toISO } from "../lib/util";
import { loadHighs } from "./highs";

export interface MilpOptions {
  horizonDays: number;
  atRiskDays: number;
  allowSplit: boolean;    // Tier 2 — solver may split an order across lane-days
  timeLimitSec: number;
}
export const DEFAULT_MILP_OPTIONS: MilpOptions = { horizonDays: 20, atRiskDays: 3, allowSplit: false, timeLimitSec: 6 };

export interface MilpResult {
  proposal: Proposal;
  method: "milp" | "greedy-fallback";
  status: string;         // solver status ("Optimal", "Time limit reached", …)
  objective?: number;
}

// Objective weights — tiered so it behaves lexicographically:
// place/meet demand  ≫  minimize (weighted) lateness  ≫  minimize setup.
const W_PLACE = 100_000;
const W_LATE = 100;
const W_SETUP = 1;
const W_DAY = 1;        // tiny earliness tie-breaker: prefer earlier days when otherwise equal
const TYPE_W: Record<OrderType, number> = { Customer: 3, Stock: 2, eComm: 1 };
const IMP_W: Record<Importance, number> = { High: 3, Medium: 2, Low: 1 };
const priorityOf = (o: Order) => TYPE_W[o.orderType] * IMP_W[o.importance]; // 1..9

function workingDays(today: string, horizon: number): string[] {
  const out: string[] = [];
  let d = fromISO(today);
  for (let i = 0; i <= horizon; i++) {
    if (!isWeekend(d)) out.push(toISO(d));
    d = addDays(d, 1);
  }
  return out;
}

/** Days `date` finishes after need-by (0 if on/before). */
const lateDays = (date: string, neededBy: string) => Math.max(0, differenceInCalendarDays(fromISO(date), fromISO(neededBy)));

/**
 * MILP auto-scheduler solved in-browser with HiGHS (WASM).
 *
 * Decision vars (Tier 1): x[o,l,d] ∈ {0,1} — order o runs whole on lane l, day d.
 * Decision vars (Tier 2): q[o,l,d] ∈ ℤ≥0 units + y[o,l,d] ∈ {0,1} — allows split.
 * Shared: z[i,l,d] ∈ {0,1} setup/batching indicator.
 *
 * Constraints: eligibility (vars only created for eligible lanes), per-lane-day
 * capacity with batching-aware setup, at-most-once / demand conservation, and
 * setup activation (z ≥ x|y). Objective minimises unplaced/short (weighted by
 * priority) ≫ weighted lateness ≫ setup hours.
 *
 * Falls back to the greedy engine on any solver error/infeasibility.
 */
export async function solveScheduleMILP(
  ds: Dataset,
  locationId: string,
  today: string,
  opts: MilpOptions = DEFAULT_MILP_OPTIONS,
): Promise<MilpResult> {
  const greedy = (): MilpResult => ({
    proposal: runAutoSchedule(ds, locationId, today, { horizonDays: opts.horizonDays, atRiskDays: opts.atRiskDays }),
    method: "greedy-fallback", status: "fallback",
  });

  try {
    const lanesAll = ds.lanes.filter((l) => l.locationId === locationId);
    const days = workingDays(today, opts.horizonDays);
    const orders = ds.orders
      .filter((o) => o.locationId === locationId && o.status !== "Completed" && !ds.assignments.some((a) => a.orderId === o.id));

    if (!orders.length) {
      return { proposal: emptyProposal(), method: "milp", status: "Optimal" };
    }

    // Precompute integer-minute capacity remaining per lane-day.
    const capMin = new Map<string, number>(); // key `${li}_${di}`
    lanesAll.forEach((l, li) => days.forEach((d, di) => {
      const rem = dayCapacityHrs(ds, l.id, d) - bookedHrs(ds, l.id, d);
      capMin.set(`${li}_${di}`, Math.max(0, Math.round(rem * 60)));
    }));

    const itemOf = (o: Order) => itemFor(ds, o) as Item;
    const eligibleLanes = (o: Order) => lanesAll.map((l, li) => ({ l, li })).filter(({ l }) => isEligible(l, itemOf(o)).ok);

    // Objective coefficients accumulated PER variable — a variable must appear
    // only once in the LP objective (HiGHS/CPLEX-LP takes the last coefficient
    // for a duplicate rather than summing them).
    const objCoef = new Map<string, number>();
    const addObj = (v: string, c: number) => { if (c !== 0) objCoef.set(v, (objCoef.get(v) ?? 0) + c); };
    const cons: string[] = [];
    const bin = new Set<string>();
    const gen = new Set<string>();
    const bounds: string[] = [];
    // Track which (item,lane,day) get a z var, and the orders that touch each cell.
    const zVars = new Set<string>();      // `${itemNumber}__${li}_${di}` → var z_{idx}
    const zName = new Map<string, string>();
    const itemIdx = new Map<string, number>();
    ds.items.forEach((it, i) => itemIdx.set(it.itemNumber, i));
    const zVarName = (itemNumber: string, li: number, di: number) => `z_${itemIdx.get(itemNumber)}_${li}_${di}`;

    // Capacity LHS accumulators per lane-day.
    const capTerms = new Map<string, string[]>(); // `${li}_${di}` -> terms
    const pushCap = (li: number, di: number, term: string) => {
      const k = `${li}_${di}`;
      if (!capTerms.has(k)) capTerms.set(k, []);
      capTerms.get(k)!.push(term);
    };

    orders.forEach((o, oi) => {
      const item = itemOf(o);
      const perUnit = item.prodTimePerUnitMins;
      const setup = item.setupTimeMins;
      const runOnly = o.qtyNeeded * perUnit;
      const prio = priorityOf(o);
      const elig = eligibleLanes(o);

      const x1Terms: string[] = []; // for at-most-once (Tier1)
      const demandTerms: string[] = []; // for conservation (Tier2)

      elig.forEach(({ li }) => days.forEach((d, di) => {
        if ((capMin.get(`${li}_${di}`) ?? 0) <= 0) return;
        const late = lateDays(d, o.neededBy);

        // ensure a z var exists for this (item,lane,day)
        const zk = `${item.itemNumber}__${li}_${di}`;
        const zn = zVarName(item.itemNumber, li, di);
        if (!zVars.has(zk)) {
          zVars.add(zk); zName.set(zk, zn); bin.add(zn);
          pushCap(li, di, `${setup} ${zn}`);            // setup charged once per item-lane-day
          addObj(zn, W_SETUP * setup);
        }

        if (!opts.allowSplit) {
          // Tier 1: whole-order binary x
          const xn = `x_${oi}_${li}_${di}`;
          bin.add(xn);
          x1Terms.push(`+ ${xn}`);
          pushCap(li, di, `${runOnly} ${xn}`);
          addObj(xn, -W_PLACE * prio);                   // reward placement
          addObj(xn, W_LATE * prio * late);              // penalise lateness (0 if on-time)
          addObj(xn, W_DAY * di);                         // prefer earlier slots on ties
          cons.push(`cz_${oi}_${li}_${di}: ${xn} - ${zn} <= 0`);    // z ≥ x
        } else {
          // Tier 2: integer quantity q + activation y
          const qn = `q_${oi}_${li}_${di}`;
          const yn = `y_${oi}_${li}_${di}`;
          gen.add(qn); bin.add(yn);
          bounds.push(`0 <= ${qn} <= ${o.qtyNeeded}`);
          demandTerms.push(`+ ${qn}`);
          pushCap(li, di, `${perUnit} ${qn}`);
          addObj(yn, W_LATE * prio * late);
          addObj(yn, W_DAY * di);                         // prefer earlier slots on ties
          cons.push(`cqy_${oi}_${li}_${di}: ${qn} - ${o.qtyNeeded} ${yn} <= 0`); // q ≤ qty·y
          cons.push(`cyq_${oi}_${li}_${di}: ${qn} - ${yn} >= 0`);                // q ≥ y
          cons.push(`cz_${oi}_${li}_${di}: ${yn} - ${zn} <= 0`);                 // z ≥ y
        }
      }));

      if (!opts.allowSplit) {
        if (x1Terms.length) cons.push(`c1_${oi}: ${x1Terms.join(" ")} <= 1`);
      } else {
        // short_o = qty - Σq ; minimise short (weighted). short ≥ 0 (default bound).
        const sn = `s_${oi}`;
        if (demandTerms.length) {
          cons.push(`cd_${oi}: ${demandTerms.join(" ")} + ${sn} = ${o.qtyNeeded}`);
        } else {
          cons.push(`cd_${oi}: ${sn} = ${o.qtyNeeded}`); // no feasible slot → all short
        }
        addObj(sn, W_PLACE * prio);
      }
    });

    // Emit capacity constraints.
    for (const [k, terms] of capTerms) {
      const rhs = capMin.get(k) ?? 0;
      cons.push(`cap_${k}: ${terms.map((t) => `+ ${t}`).join(" ")} <= ${rhs}`);
    }

    const objStr = [...objCoef].map(([v, c]) => (c >= 0 ? `+${c} ${v}` : `-${Math.abs(c)} ${v}`)).join(" ");
    const lp = [
      "Minimize",
      ` obj: ${objStr || "0"}`,
      "Subject To",
      ...cons.map((c) => ` ${c}`),
      "Bounds",
      ...bounds.map((b) => ` ${b}`),
      ...(gen.size ? ["General", ` ${[...gen].join(" ")}`] : []),
      ...(bin.size ? ["Binary", ` ${[...bin].join(" ")}`] : []),
      "End",
    ].join("\n");

    const highs = await loadHighs();
    const sol = highs.solve(lp, { time_limit: opts.timeLimitSec, presolve: "on" });
    const cols = sol.Columns as Record<string, { Primal: number }>;
    const val = (name: string) => cols[name]?.Primal ?? 0;

    if (sol.Status !== "Optimal" && sol.Status !== "Time limit reached") {
      return greedy();
    }

    const proposal = buildProposal(ds, orders, lanesAll, days, opts, val, itemOf);
    return { proposal, method: "milp", status: sol.Status, objective: sol.ObjectiveValue };
  } catch (err) {
    console.warn("MILP solve failed, falling back to greedy:", err);
    return greedy();
  }
}

// ---- Solution → Proposal --------------------------------------------------

function buildProposal(
  ds: Dataset,
  orders: Order[],
  lanes: Dataset["lanes"],
  days: string[],
  opts: MilpOptions,
  val: (name: string) => number,
  itemOf: (o: Order) => Item,
): Proposal {
  // Collect raw segments per order.
  interface Raw { oi: number; li: number; di: number; qty: number; }
  const raws: Raw[] = [];
  orders.forEach((o, oi) => {
    lanes.forEach((_l, li) => days.forEach((_d, di) => {
      if (!opts.allowSplit) {
        if (val(`x_${oi}_${li}_${di}`) > 0.5) raws.push({ oi, li, di, qty: o.qtyNeeded });
      } else {
        const q = Math.round(val(`q_${oi}_${li}_${di}`));
        if (q > 0) raws.push({ oi, li, di, qty: q });
      }
    }));
  });

  // Group by (item, lane, day) to attribute the single shared setup.
  const groupKey = (r: Raw) => `${itemOf(orders[r.oi]).itemNumber}__${r.li}_${r.di}`;
  const groups = new Map<string, Raw[]>();
  raws.forEach((r) => { const k = groupKey(r); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); });
  const setupPayer = new Set<Raw>();
  let setupHrsSaved = 0;
  for (const g of groups.values()) {
    setupPayer.add(g[0]); // first segment in the cell pays setup; the rest are batched
    const setup = itemOf(orders[g[0].oi]).setupTimeMins / 60;
    setupHrsSaved += setup * (g.length - 1);
  }

  const items: ProposalItem[] = orders.map((o, oi) => {
    const item = itemOf(o);
    const base: ProposalItem = {
      orderId: o.id, productionNo: o.productionNo, itemNumber: o.itemNumber, itemType: item.type,
      qty: o.qtyNeeded, orderType: o.orderType, importance: o.importance, neededBy: o.neededBy,
      placed: false, batched: false, setupSaved: 0, risk: "unplaceable", reason: "",
    };
    const mine = raws.filter((r) => r.oi === oi);
    if (!mine.length) {
      const eligible = ds.lanes.some((l) => l.locationId === o.locationId && isEligible(l, item).ok);
      return { ...base, reason: eligible ? `no capacity in the next ${opts.horizonDays} days` : `no eligible ${item.type} lane` };
    }

    const segments: PlacementSegment[] = mine.map((r) => {
      const lane = lanes[r.li];
      const batched = !setupPayer.has(r);
      const setupPart = setupPayer.has(r) ? item.setupTimeMins / 60 : 0;
      const runHrs = setupPart + (r.qty * item.prodTimePerUnitMins) / 60;
      return { laneId: lane.id, laneCode: lane.code, date: days[r.di], qty: r.qty, runHrs: Math.round(runHrs * 100) / 100, batched };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const placedQty = mine.reduce((s, r) => s + r.qty, 0);
    const lastDate = segments.reduce((m, s) => (s.date > m ? s.date : m), segments[0].date);
    const risk: RiskLevel = riskFor(lastDate, o.neededBy, opts.atRiskDays);
    const short = o.qtyNeeded - placedQty;
    const setupSaved = segments.filter((s) => s.batched).reduce(() => item.setupTimeMins / 60, 0);
    const anyBatched = segments.some((s) => s.batched);

    const reason = short > 0 ? `partial — ${placedQty}/${o.qtyNeeded} units placed, ${short} couldn't fit`
      : segments.length > 1 ? `split across ${segments.length} lane-days`
      : risk === "late" ? "placed, but completes after need-by"
      : risk === "at-risk" ? "placed with little buffer before need-by"
      : anyBatched ? "batched with a same-item run — setup shared"
      : "placed on-time";

    return {
      ...base, placed: true,
      laneId: segments[0].laneId, laneCode: segments[0].laneCode, date: segments[0].date,
      runHrs: segments.reduce((s, x) => s + x.runHrs, 0),
      batched: anyBatched, setupSaved, segments, risk, reason,
    };
  });

  const placed = items.filter((i) => i.placed);
  return {
    items,
    placedCount: placed.length,
    onTimeCount: placed.filter((i) => i.risk === "on-time").length,
    atRiskCount: placed.filter((i) => i.risk === "at-risk").length,
    lateCount: placed.filter((i) => i.risk === "late").length,
    unplaceableCount: items.length - placed.length,
    setupHrsSaved: Math.round(setupHrsSaved * 100) / 100,
  };
}

function emptyProposal(): Proposal {
  return { items: [], placedCount: 0, onTimeCount: 0, atRiskCount: 0, lateCount: 0, unplaceableCount: 0, setupHrsSaved: 0 };
}
