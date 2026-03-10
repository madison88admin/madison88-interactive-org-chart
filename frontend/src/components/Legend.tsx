interface LegendProps {
  compact?: boolean;
  showStatusColors?: boolean;
}

export function Legend({ compact = false, showStatusColors = true }: LegendProps) {
  if (!showStatusColors) {
    return null;
  }
  return (
    <section className={`legend-panel ${compact ? "legend-panel-compact" : ""}`} aria-label="Legend">
      {!compact && <h3>Legend</h3>}
      <div className="legend-row">
        <span className="dot promoted" /> Promoted 2026
      </div>
      <div className="legend-row">
        <span className="dot enhanced" /> Enhanced title 2026
      </div>
      <div className="legend-row">
        <span className="dot new-hire" /> New hire 2026
      </div>
      {!compact && (
        <div className="legend-row">
          <span className="dot standard" /> Standard role
        </div>
      )}
    </section>
  );
}
