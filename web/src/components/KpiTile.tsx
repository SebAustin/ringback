interface KpiTileProps {
  label: string;
  value: string;
  loading?: boolean;
}

/** A single metric tile for the /ops KPI row. */
export function KpiTile({ label, value, loading = false }: KpiTileProps) {
  return (
    <div className="kpi-tile">
      <div className="kpi-label">{label}</div>
      {loading ? (
        <div className="skeleton console-skeleton" style={{ height: '1.8rem', marginTop: '0.35rem' }} />
      ) : (
        <div className="kpi-value">{value}</div>
      )}
    </div>
  );
}
