import type { SortDir } from "../../lib/useSort";

/** Clickable table header that sorts a column and shows the active direction. */
export function SortableTh({ label, col, sortKey, sortDir, onSort, className, align }: {
  label: string;
  col: string;
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (col: string) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th
      className={className}
      onClick={() => onSort(col)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer", userSelect: "none", textAlign: align ?? "left", whiteSpace: "nowrap" }}
      title="Click to sort"
    >
      {label}
      <span aria-hidden style={{ marginLeft: 5, fontSize: 9, opacity: active ? 0.9 : 0.3 }}>
        {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
      </span>
    </th>
  );
}
