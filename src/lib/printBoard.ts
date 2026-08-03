import { format } from "date-fns";
import type { Dataset, Lane, Order } from "../domain/types";
import { assignmentsFor, itemFor, laneDayLoad } from "../domain/capacity";
import { classifyRisk, type RiskLevel } from "../domain/risk";
import { fmtDate, fmtHrs, fromISO } from "./util";

export interface PrintWeekParams {
  ds: Dataset;
  locationId: string;
  lanes: Lane[];        // already filtered to the location (+ any lane-type filter on screen)
  days: string[];       // the working week currently in view (ISO, Mon–Fri)
  unscheduled: Order[]; // unscheduled orders in view — printed as a "not on the board" list
  today: string;
  plannerName: string;
}

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const RISK_CLASS: Record<RiskLevel, string> = { "on-time": "ontime", "at-risk": "atrisk", late: "late" };

/**
 * Build a print-optimised, self-contained HTML document for the week currently
 * shown on the scheduling board. Pure (no DOM side effects) so it can be tested
 * and screenshotted directly. Mirrors exactly what the planner sees on screen
 * (same location, week, and lane filter).
 */
export function buildWeekBoardHtml(p: PrintWeekParams): string {
  const { ds, locationId, lanes, days, unscheduled, today, plannerName } = p;
  const location = ds.locations.find((l) => l.id === locationId);
  const weekLabel = days.length
    ? `${format(fromISO(days[0]), "MMM d")} – ${format(fromISO(days[days.length - 1]), "MMM d, yyyy")}`
    : "—";
  const generated = format(new Date(), "MMM d, yyyy · h:mm a");

  const dayHead = days
    .map((d) => `<th class="${d === today ? "today" : ""}">${esc(format(fromISO(d), "EEE"))}<span>${esc(format(fromISO(d), "M/d"))}</span></th>`)
    .join("");

  const cell = (lane: Lane, date: string): string => {
    const load = laneDayLoad(ds, lane.id, date);
    const override = ds.laneDays.find((x) => x.laneId === lane.id && x.date === date);
    const blocks = ds.assignments
      .filter((a) => a.laneId === lane.id && a.date === date)
      .map((a) => {
        const order = ds.orders.find((o) => o.id === a.orderId);
        if (!order) return "";
        const risk = classifyRisk(order, assignmentsFor(ds, order.id), today);
        return `<div class="blk ${RISK_CLASS[risk]}">
            <b>${esc(order.productionNo)}</b>
            <span>${esc(order.itemNumber)} · ${esc(order.orderType)}/${esc(order.importance[0])} · qty ${esc(order.qtyNeeded)} · ${esc(fmtHrs(a.runHrs))}</span>
          </div>`;
      })
      .join("");
    const overCls = load.over ? "over" : "";
    const capNote = override ? `<span class="exc">${esc(override.exception ?? "override")}</span>` : "";
    return `<td>
        ${blocks || '<div class="empty">—</div>'}
        <div class="cap ${overCls}">${esc(fmtHrs(load.booked))} / ${esc(load.capacity)} hr${capNote}</div>
      </td>`;
  };

  const rows = lanes
    .map((lane) => `<tr>
        <th class="lane">${esc(lane.name)}<span>${esc(lane.code)} · ${esc(lane.type)} · ${esc(lane.defaultCapacityHrs)} hr cap</span></th>
        ${days.map((d) => cell(lane, d)).join("")}
      </tr>`)
    .join("");

  const unsched = unscheduled.length
    ? `<section class="unsched">
        <h2>Unscheduled — not on the board (${unscheduled.length})</h2>
        <table class="list">
          <thead><tr><th>Production #</th><th>Item</th><th>Type</th><th>Importance</th><th class="r">Qty</th><th>Needed by</th><th>Risk</th></tr></thead>
          <tbody>
            ${unscheduled.map((o) => {
              const item = itemFor(ds, o);
              const risk = classifyRisk(o, [], today);
              return `<tr>
                  <td>${esc(o.productionNo)}</td>
                  <td>${esc(o.itemNumber)}${item ? ` · ${esc(item.type)}` : ""}</td>
                  <td>${esc(o.orderType)}</td>
                  <td>${esc(o.importance)}</td>
                  <td class="r">${esc(o.qtyNeeded)}</td>
                  <td>${esc(fmtDate(o.neededBy))}</td>
                  <td><span class="pill ${RISK_CLASS[risk]}">${esc(risk)}</span></td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </section>`
    : `<section class="unsched"><p class="allplaced">All orders in view are placed on the board.</p></section>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bishop Weekly Schedule — ${esc(location?.name ?? "")} — ${esc(weekLabel)}</title>
<style>
  @page { size: landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #16201b; font-size: 12px; }

  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1e7a4b; padding-bottom: 10px; margin-bottom: 14px; }
  header .title { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
  header .sub { color: #5b6b62; font-size: 12px; margin-top: 2px; }
  header .meta { text-align: right; color: #5b6b62; font-size: 11px; line-height: 1.5; }
  header .meta b { color: #16201b; }

  table.board { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.board th, table.board td { border: 1px solid #cbd3cd; vertical-align: top; }
  table.board thead th { background: #16201b; color: #fff; font-size: 11px; padding: 6px 4px; text-align: center; }
  table.board thead th span { display: block; font-weight: 400; opacity: 0.85; }
  table.board thead th.today { background: #1e7a4b; }
  table.board th.lane { width: 15%; background: #eef2ef; text-align: left; padding: 6px 8px; font-size: 11px; color: #16201b; }
  table.board th.lane span { display: block; font-weight: 400; color: #5b6b62; font-size: 10px; margin-top: 2px; }
  table.board td { padding: 4px; }

  .blk { border-left: 3px solid #6b7280; background: #f6f7f6; border-radius: 0 3px 3px 0; padding: 3px 5px; margin-bottom: 3px; page-break-inside: avoid; }
  .blk b { display: block; font-size: 11px; }
  .blk span { display: block; color: #5b6b62; font-size: 9.5px; }
  .blk.atrisk { border-left-color: #c1842a; background: #fbf3e3; }
  .blk.late { border-left-color: #b23a32; background: #f8e7e5; }
  .empty { color: #b7c0b9; text-align: center; padding: 4px 0; }

  .cap { font-size: 9.5px; color: #5b6b62; text-align: right; border-top: 1px dashed #dce3de; margin-top: 3px; padding-top: 2px; }
  .cap.over { color: #b23a32; font-weight: 700; }
  .cap .exc { display: inline-block; margin-left: 5px; color: #c1842a; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }

  .legend { display: flex; gap: 16px; margin: 12px 0 0; font-size: 10.5px; color: #5b6b62; align-items: center; }
  .legend .swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }

  section.unsched { margin-top: 20px; page-break-inside: avoid; }
  section.unsched h2 { font-size: 13px; margin: 0 0 8px; color: #16201b; }
  .allplaced { color: #5b6b62; font-style: italic; }
  table.list { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.list th, table.list td { border-bottom: 1px solid #dce3de; padding: 5px 8px; text-align: left; }
  table.list thead th { background: #eef2ef; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #5b6b62; }
  table.list .r { text-align: right; }
  .pill { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 10px; }
  .pill.ontime { background: #eef2ef; color: #4b5a51; }
  .pill.atrisk { background: #fbf3e3; color: #a06a1a; }
  .pill.late { background: #f8e7e5; color: #9a2f28; }

  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #dce3de; color: #8a968e; font-size: 10px; display: flex; justify-content: space-between; }

  @media print { body { padding: 0; } .noprint { display: none; } }
</style>
</head>
<body>
  <header>
    <div>
      <div class="title">Bishop Lifting — Weekly Production Schedule</div>
      <div class="sub">${esc(location?.name ?? "Location")}${location?.city ? ` · ${esc(location.city)}, ${esc(location.state)}` : ""} &nbsp;•&nbsp; Week of ${esc(weekLabel)}</div>
    </div>
    <div class="meta">
      <div>Prepared by <b>${esc(plannerName)}</b></div>
      <div>Generated ${esc(generated)}</div>
    </div>
  </header>

  <table class="board">
    <thead><tr><th class="lane">Lane</th>${dayHead}</tr></thead>
    <tbody>
      ${rows || `<tr><td colspan="${days.length + 1}" style="text-align:center;padding:24px;color:#8a968e;">No lanes match the current filter for ${esc(location?.name ?? "this location")}.</td></tr>`}
    </tbody>
  </table>

  <div class="legend">
    <span><span class="swatch" style="background:#6b7280"></span>On-time</span>
    <span><span class="swatch" style="background:#c1842a"></span>At-risk</span>
    <span><span class="swatch" style="background:#b23a32"></span>Late</span>
    <span style="margin-left:auto;color:#8a968e;">Cell footer = booked / hard-cap hours for that lane-day.</span>
  </div>

  ${unsched}

  <footer>
    <span>Bishop Synthetics Production Planning</span>
    <span>Snapshot — schedule may change after printing</span>
  </footer>

  <script>window.addEventListener("load", function () { window.focus(); window.print(); });</script>
</body>
</html>`;

  return html;
}

/**
 * Open the printable week document in a separate window and trigger the browser
 * print dialog. Rendered in its own window so it never fights the app's
 * interactive board layout. Returns false if the popup was blocked so the caller
 * can prompt the user.
 */
export function printWeekBoard(p: PrintWeekParams): boolean {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return false;
  win.document.open();
  win.document.write(buildWeekBoardHtml(p));
  win.document.close();
  return true;
}
