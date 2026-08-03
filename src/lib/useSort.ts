import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean;
export type Accessor<T> = (row: T) => SortValue;

/**
 * Client-side table sorting. `accessors` maps a column key to the value to sort
 * by; pass it as a module-level constant so its identity is stable across
 * renders. `toggle(key)` sorts ascending, then flips to descending on re-click.
 */
export function useSort<T>(
  rows: T[],
  accessors: Record<string, Accessor<T>>,
  initialKey: string | null = null,
  initialDir: SortDir = "asc",
) {
  const [sortKey, setSortKey] = useState<string | null>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(() => {
    const acc = sortKey ? accessors[sortKey] : undefined;
    if (!acc) return rows;
    const m = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * m;
      return (va < vb ? -1 : va > vb ? 1 : 0) * m;
    });
  }, [rows, sortKey, sortDir, accessors]);

  const toggle = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return { sorted, sortKey, sortDir, toggle };
}
