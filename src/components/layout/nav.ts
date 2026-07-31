import type { ViewKey } from "../../auth/permissions";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
  badge?: number;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: "Plan", items: [
    { key: "board", label: "Scheduling board", icon: "▦" },
    { key: "autoschedule", label: "Auto-schedule", icon: "⚡", badge: 6 },
    { key: "batching", label: "Batching", icon: "⧉" },
  ] },
  { label: "Work", items: [
    { key: "orders", label: "Orders", icon: "▤" },
    { key: "status", label: "Status board", icon: "◔" },
  ] },
  { label: "Insights", items: [
    { key: "dashboards", label: "Dashboards", icon: "◫" },
  ] },
  { label: "Setup", items: [
    { key: "items", label: "Items", icon: "◆" },
    { key: "lanes", label: "Lanes & capacity", icon: "═" },
    { key: "locations", label: "Locations", icon: "⌂" },
    { key: "admin", label: "Users & roles", icon: "⚙" },
  ] },
];

export const TITLES: Record<ViewKey, [string, string]> = {
  board: ["Scheduling board", "Plan / Scheduling board"],
  autoschedule: ["Auto-schedule proposals", "Plan / Auto-schedule"],
  batching: ["Batching recommendations", "Plan / Batching"],
  orders: ["Orders", "Work / Orders"],
  status: ["Status board", "Work / Status board"],
  dashboards: ["Dashboards", "Insights / Dashboards"],
  items: ["Item master", "Setup / Items"],
  lanes: ["Lanes & capacity", "Setup / Lanes"],
  locations: ["Locations", "Setup / Locations"],
  admin: ["Users & roles", "Setup / Admin"],
};
