interface KpiProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaDir?: "up" | "down";
}

export function Kpi({ label, value, delta, deltaDir }: KpiProps) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${deltaDir ?? ""}`}>{delta}</div>}
    </div>
  );
}
