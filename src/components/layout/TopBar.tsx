import { useAppStore } from "../../store/useAppStore";
import { TITLES } from "./nav";
import styles from "./TopBar.module.css";

function initials(name: string): string {
  return name.replace(/[^A-Za-z. ]/g, "").split(/[.\s]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function TopBar() {
  const view = useAppStore((s) => s.view);
  const locations = useAppStore((s) => s.ds.locations);
  const locationId = useAppStore((s) => s.locationId);
  const setLocation = useAppStore((s) => s.setLocation);
  const userName = useAppStore((s) => s.currentUserName);
  const [title, crumb] = TITLES[view];

  return (
    <div className={styles.topbar}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.crumbs}>{crumb}</div>
      </div>
      <div className={styles.right}>
        <select className={styles.loc} value={locationId} onChange={(e) => setLocation(e.target.value)}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className={styles.avatar} title={userName}>{initials(userName)}</div>
      </div>
    </div>
  );
}
