import { useEffect } from "react";
import { useAppStore } from "./store/useAppStore";
import type { ViewKey } from "./auth/permissions";
import { can } from "./auth/permissions";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { Toaster } from "./components/ui/Toaster";

import { BoardView } from "./views/Board/BoardView";
import { OrdersView } from "./views/Orders/OrdersView";
import { StatusView } from "./views/Status/StatusView";
import { DashboardsView } from "./views/Dashboards/DashboardsView";
import { ItemsView } from "./views/Items/ItemsView";
import { LanesView } from "./views/Lanes/LanesView";
import { LocationsView } from "./views/Locations/LocationsView";
import { AdminView } from "./views/Admin/AdminView";
import { ComingSoon } from "./views/ComingSoon";

const VIEWS: Record<ViewKey, () => React.JSX.Element> = {
  board: BoardView,
  orders: OrdersView,
  status: StatusView,
  dashboards: DashboardsView,
  items: ItemsView,
  lanes: LanesView,
  locations: LocationsView,
  admin: AdminView,
  autoschedule: () => (
    <ComingSoon
      glyph="⚡"
      title="Auto-scheduler — coming next"
      body="The auto-scheduling engine will sequence unscheduled orders by need-by date, then apply batching, order-type priority, and skill match — proposing a lane/day plan you approve before anything commits. It's the next module we build."
    />
  ),
  batching: () => (
    <ComingSoon
      glyph="⧉"
      title="Batching recommendations — coming next"
      body="Batching groups like orders within a time window to save setup time. It ships alongside the auto-scheduler in the next phase; until then you can batch manually on the scheduling board."
    />
  ),
};

export function App() {
  const ready = useAppStore((s) => s.ready);
  const init = useAppStore((s) => s.init);
  const view = useAppStore((s) => s.view);
  const role = useAppStore((s) => s.role);

  useEffect(() => { void init(); }, [init]);

  if (!ready) {
    return <div style={{ padding: 40, color: "var(--ink2)" }}>Loading Bishop Production Planning…</div>;
  }

  // RBAC guard — if the role can't see the current view, fall back to its landing.
  const allowed = can(role).views;
  const activeKey: ViewKey = allowed.includes(view) ? view : can(role).landing;
  const ViewComponent = VIEWS[activeKey];

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <div className="content">
          <ViewComponent />
        </div>
      </div>
      <Toaster />
    </div>
  );
}
