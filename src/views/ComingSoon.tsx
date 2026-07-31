export function ComingSoon({ glyph, title, body }: { glyph: string; title: string; body: string }) {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="glyph">{glyph}</div>
        <h2>{title}</h2>
        <p>{body}</p>
        <span className="tag scheduled" style={{ marginTop: 8 }}>Planned — next phase</span>
      </div>
    </div>
  );
}
