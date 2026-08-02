import { useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import { earliestFit, findBatchGroups, type BatchGroup } from "../../domain/batching";
import { fmtDate, fmtHrs, fmtShort } from "../../lib/util";
import styles from "./Batching.module.css";

export function BatchingView() {
  const ds = useAppStore((s) => s.ds);
  const locationId = useAppStore((s) => s.locationId);
  const role = useAppStore((s) => s.role);
  const canEdit = can(role).editOrders;

  const [windowDays, setWindowDays] = useState(2);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => findBatchGroups(ds, locationId, windowDays).filter((g) => !dismissed.has(g.id)),
    [ds, locationId, windowDays, dismissed],
  );
  const totalSaved = groups.reduce((s, g) => s + g.setupSavedHrs, 0);
  const locName = ds.locations.find((l) => l.id === locationId)?.name;

  return (
    <>
      <div className="card">
        <div className={styles.introRow}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>Batching recommendations</div>
            <p className="hint" style={{ marginTop: 4, maxWidth: 620 }}>
              Unscheduled orders of the same item with need-by dates close together can run together on one
              lane-day, paying a single machine setup instead of one per order. {groups.length > 0 && <>Applying all would save <b>{fmtHrs(totalSaved)}</b> of setup at {locName}.</>}
            </p>
          </div>
          <label className={styles.ctl}>
            Need-by window
            <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              {[1, 2, 3, 5, 7].map((w) => <option key={w} value={w}>± {w} day{w === 1 ? "" : "s"}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!groups.length && (
        <div className="card">
          <div className="empty-state">
            <div className="glyph">⧉</div>
            <h2>No batches in this window</h2>
            <p>No unscheduled orders at {locName} share an item within ± {windowDays} day{windowDays === 1 ? "" : "s"}. Widen the window, or add more orders.</p>
          </div>
        </div>
      )}

      {groups.map((g) => (
        <BatchCard key={g.id} group={g} canEdit={canEdit} onDismiss={() => setDismissed((p) => new Set(p).add(g.id))} />
      ))}
    </>
  );
}

function BatchCard({ group, canEdit, onDismiss }: { group: BatchGroup; canEdit: boolean; onDismiss: () => void }) {
  const ds = useAppStore((s) => s.ds);
  const today = useAppStore((s) => s.today);
  const applyBatch = useAppStore((s) => s.applyBatch);
  const toast = useAppStore((s) => s.toast);

  const [laneId, setLaneId] = useState(group.eligibleLanes[0]?.id ?? "");
  const fitDate = useMemo(
    () => (laneId ? earliestFit(ds, laneId, group.combinedHrs, today) : null),
    [ds, laneId, group.combinedHrs, today],
  );

  const apply = () => {
    if (!laneId || !fitDate) { toast("error", "This batch doesn't fit a single day on the selected lane."); return; }
    applyBatch(group.orders.map((o) => o.id), laneId, fitDate);
  };

  return (
    <div className="card">
      <div className={styles.head}>
        <div>
          <span className="tag ok" style={{ marginRight: 8 }}>{group.itemType}</span>
          <b>{group.itemNumber}</b> <span className="muted">· {group.description}</span>
        </div>
        <div className={styles.saved} title="Setup time avoided by sharing one setup">
          saves {fmtHrs(group.setupSavedHrs)} setup
        </div>
      </div>

      <div className={styles.orders}>
        {group.orders.map((o) => (
          <span key={o.id} className={styles.chip}>
            <b>{o.productionNo}</b> · {o.qty}u · by {fmtShort(o.neededBy)}
          </span>
        ))}
      </div>

      <div className={styles.metaRow}>
        <span className="muted">{group.orders.length} orders · {group.totalQty} units · {fmtHrs(group.combinedHrs)} combined · need-by spread {group.spanDays}d</span>
        {canEdit && (
          <div className={styles.actions}>
            <label className={styles.laneSel}>
              onto
              <select value={laneId} onChange={(e) => setLaneId(e.target.value)}>
                {group.eligibleLanes.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
              </select>
            </label>
            <span className={styles.slot}>{fitDate ? `· ${fmtDate(fitDate)}` : "· no single-day fit"}</span>
            <button className="btn" onClick={onDismiss}>Dismiss</button>
            <button className="btn primary" onClick={apply} disabled={!fitDate}>Batch</button>
          </div>
        )}
      </div>
    </div>
  );
}
