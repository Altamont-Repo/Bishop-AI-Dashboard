import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import { type Proposal, type ProposalItem } from "../../domain/scheduler";
import { DEFAULT_MILP_OPTIONS, solveScheduleMILP, type MilpResult } from "../../domain/milpScheduler";
import { RISK_TAG } from "../../domain/risk";
import { fmtDate, fmtHrs, fmtShort } from "../../lib/util";
import { Kpi } from "../../components/ui/Kpi";
import styles from "./AutoSchedule.module.css";

export function AutoScheduleView() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const today = useAppStore((s) => s.today);
  const role = useAppStore((s) => s.role);
  const setView = useAppStore((s) => s.setView);
  const applyProposal = useAppStore((s) => s.applyProposal);
  const canRun = can(role).runScheduler;

  const locName = ds.locations.find((l) => l.id === locationId)?.name;
  const [weeks, setWeeks] = useState(4);
  const [allowSplit, setAllowSplit] = useState(false);
  const [result, setResult] = useState<MilpResult | null>(null);
  const [solving, setSolving] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [runNo, setRunNo] = useState(0);

  const proposal: Proposal | null = result?.proposal ?? null;

  const run = async () => {
    setSolving(true);
    try {
      const res = await solveScheduleMILP(ds, locationId, today, {
        ...DEFAULT_MILP_OPTIONS, horizonDays: weeks * 5, allowSplit,
      });
      setResult(res);
      setExcluded(new Set());
      setRunNo((n) => n + 1);
    } finally {
      setSolving(false);
    }
  };

  const accepted = useMemo(
    () => (proposal ? proposal.items.filter((i) => i.placed && !excluded.has(i.orderId)) : []),
    [proposal, excluded],
  );

  const toggle = (id: string) => setExcluded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const accept = () => {
    applyProposal(accepted);
    setResult(null);
    setView("board");
  };

  if (!canRun) {
    return <div className="card"><p className="hint">Your role can view the board but not run the auto-scheduler. Switch to Production Planner, Plant Manager, or Admin.</p></div>;
  }

  const unplaceable = proposal ? proposal.items.filter((i) => !i.placed) : [];

  return (
    <>
      <div className="card">
        <div className={styles.introRow}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>Auto-scheduler <span className={styles.engineTag}>MILP · HiGHS</span></div>
            <p className="hint" style={{ marginTop: 4, maxWidth: 640 }}>
              Optimises the schedule for unscheduled orders at <b>{locName}</b> using a mixed-integer solver —
              maximising on-time placements (weighted by customer priority), then minimising lateness and setup.
              It respects lane eligibility, hard capacity, and any work already committed. Nothing commits until you accept.
            </p>
          </div>
          <div className={styles.controls}>
            <label className={styles.ctl}>
              Look ahead
              <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} disabled={solving}>
                {[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} week{w === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <label className={styles.ctl}>
              Mode
              <select value={allowSplit ? "split" : "whole"} onChange={(e) => setAllowSplit(e.target.value === "split")} disabled={solving}>
                <option value="whole">Whole order</option>
                <option value="split">Allow split across days</option>
              </select>
            </label>
            <button className="btn primary" onClick={run} disabled={solving}>
              {solving ? "Solving…" : proposal ? "Re-run" : "Run auto-scheduler"}
            </button>
          </div>
        </div>
      </div>

      {!proposal && !solving && (
        <div className="card">
          <div className="empty-state">
            <div className="glyph">⚡</div>
            <h2>Ready when you are</h2>
            <p>Pick a horizon and mode, then <b>Run auto-scheduler</b>. The solver proposes an optimised schedule for every unscheduled order at {locName}; you review and approve before anything lands on the board.</p>
          </div>
        </div>
      )}

      {solving && (
        <div className="card"><div className="empty-state"><div className="glyph">⏳</div><h2>Optimising…</h2><p>HiGHS is searching for the best feasible schedule.</p></div></div>
      )}

      {proposal && !solving && (
        <>
          <div className={styles.statusLine}>
            {result?.method === "milp"
              ? <span className={styles.ok}>✓ Solved with HiGHS — <b>{result.status === "Optimal" ? "optimal" : "best within time limit"}</b>{allowSplit ? " · split allowed" : " · whole-order"}</span>
              : <span className={styles.warn}>⚠ Solver unavailable — fell back to the greedy heuristic</span>}
          </div>

          <div className="grid4" style={{ margin: "10px 0 14px" }}>
            <Kpi label="Orders placed" value={`${proposal.placedCount} / ${proposal.items.length}`} />
            <Kpi label="On-time" value={proposal.onTimeCount} delta={`${proposal.atRiskCount} at-risk · ${proposal.lateCount} late`} deltaDir={proposal.lateCount ? "down" : "up"} />
            <Kpi label="Couldn't place" value={proposal.unplaceableCount} deltaDir={proposal.unplaceableCount ? "down" : "up"} delta={proposal.unplaceableCount ? "need capacity/eligibility" : "all placed"} />
            <Kpi label="Setup saved (batching)" value={fmtHrs(proposal.setupHrsSaved)} />
          </div>

          <div className="card flush">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}></th>
                  <th>Order</th><th>Item</th><th>Qty</th><th>Type</th><th>Needed by</th>
                  <th>Proposed slot</th><th>Run</th><th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {proposal.items.map((it) => (
                  <ProposalRow key={it.orderId} item={it} excluded={excluded.has(it.orderId)} onToggle={() => toggle(it.orderId)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <div className="hint" style={{ margin: 0 }}>
              Run #{runNo} · {accepted.length} placement{accepted.length === 1 ? "" : "s"} selected
              {unplaceable.length > 0 && <> · {unplaceable.length} order{unplaceable.length === 1 ? "" : "s"} still need attention</>}
            </div>
            <div className="row">
              <button className="btn" onClick={() => setResult(null)}>Discard</button>
              <button className="btn primary" onClick={accept} disabled={!accepted.length}>Accept {accepted.length || ""} placement{accepted.length === 1 ? "" : "s"}</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ProposalRow({ item, excluded, onToggle }: { item: ProposalItem; excluded: boolean; onToggle: () => void }) {
  const tagClass = item.risk === "unplaceable" ? "late" : RISK_TAG[item.risk];
  const multi = item.segments && item.segments.length > 1;
  return (
    <tr className={!item.placed ? styles.unplaceable : excluded ? styles.excluded : ""}>
      <td>
        {item.placed
          ? <input type="checkbox" checked={!excluded} onChange={onToggle} style={{ width: "auto" }} title="Include in accept" />
          : <span title="Cannot be placed">⚠️</span>}
      </td>
      <td><b>{item.productionNo}</b></td>
      <td>{item.itemNumber} <span className="muted">· {item.itemType}</span></td>
      <td>{item.qty}</td>
      <td>{item.orderType}</td>
      <td>{fmtDate(item.neededBy)}</td>
      <td>
        {!item.placed ? <span className="muted">—</span>
          : multi
            ? <span>{item.segments!.map((s, i) => (
                <span key={i} className={styles.seg}><b>{s.laneCode}</b> {fmtShort(s.date)} <span className="muted">×{s.qty}</span></span>
              ))}<span className={styles.batchTag}>split</span></span>
            : <span><b>{item.laneCode}</b> · {fmtShort(item.date!)}{item.batched && <span className={styles.batchTag} title="Setup shared with a same-item run">batched</span>}</span>}
      </td>
      <td>{item.placed ? fmtHrs(item.runHrs ?? 0) : "—"}</td>
      <td><span className={`tag ${tagClass}`}>{item.risk === "unplaceable" ? "can't place" : item.risk}</span><div className={styles.reason}>{item.reason}</div></td>
    </tr>
  );
}
