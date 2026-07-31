import { useAppStore } from "../../store/useAppStore";
import { can } from "../../auth/permissions";
import type { Role } from "../../domain/types";
import { NAV } from "./nav";
import styles from "./Sidebar.module.css";

const ROLES: Role[] = ["Production Planner", "Shift Operator", "Plant Manager", "Admin"];

export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const role = useAppStore((s) => s.role);
  const setRole = useAppStore((s) => s.setRole);
  const allowed = can(role).views;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.name}>BISHOP LIFTING</div>
        <div className={styles.sub}>Synthetics Production Planning</div>
      </div>

      <nav className={styles.nav}>
        {NAV.map((group) => {
          const items = group.items.filter((it) => allowed.includes(it.key));
          if (!items.length) return null;
          return (
            <div className={styles.group} key={group.label}>
              <div className={styles.groupLabel}>{group.label}</div>
              {items.map((it) => (
                <div
                  key={it.key}
                  className={`${styles.item} ${view === it.key ? styles.active : ""}`}
                  onClick={() => setView(it.key)}
                >
                  <span className={styles.icon}>{it.icon}</span>
                  {it.label}
                  {it.badge != null && <span className="badge-count">{it.badge}</span>}
                </div>
              ))}
            </div>
          );
        })}
      </nav>

      <div className={styles.roleSwitch}>
        <label htmlFor="role">Viewing as</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    </aside>
  );
}
