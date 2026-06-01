export default function EvidenceLog({ entries }) {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Evidence</p>
          <h2>Evidence log</h2>
        </div>
      </div>
      <div className="evidence-list">
        {entries.length === 0 ? <div className="empty-state">Evidence will appear after parsing and evaluation.</div> : entries.map((entry) => <code key={entry}>{entry}</code>)}
      </div>
    </section>
  );
}
