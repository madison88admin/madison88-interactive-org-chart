interface MiniMapProps {
  zoom: number;
  translate: { x: number; y: number };
  totalNodes: number;
}

export function MiniMap({ zoom, translate, totalNodes }: MiniMapProps) {
  const left = Math.max(5, Math.min(65, 35 + translate.x / 80));
  const top = Math.max(5, Math.min(65, 35 + translate.y / 80));
  const size = Math.max(18, 48 / Math.max(zoom, 0.4));

  return (
    <section className="minimap-panel" aria-label="Mini map">
      <h3>Mini-map</h3>
      <div className="minimap-box">
        <div className="minimap-grid" />
        <div className="minimap-viewport" style={{ left: `${left}%`, top: `${top}%`, width: `${size}%`, height: `${size}%` }} />
      </div>
      <p>{totalNodes} visible employees</p>
    </section>
  );
}
