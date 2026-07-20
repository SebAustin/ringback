interface StatusChipProps {
  status: string;
  pulse?: boolean;
  label?: string;
}

/**
 * Small pill indicating a status value (conversation status, run status,
 * outcome badge). `status` is used as a CSS class suffix, e.g.
 * `status-active`, `status-awaiting_approval`.
 */
export function StatusChip({ status, pulse = false, label }: StatusChipProps) {
  const className = `status-chip status-${status}${pulse ? ' pulse' : ''}`;
  return (
    <span className={className}>
      <span className="status-dot" aria-hidden="true" />
      {label ?? status.replace(/_/g, ' ')}
    </span>
  );
}
