import { sampleStateTimeline } from '../data/sampleMachines.js';

export default function StateTimeline() {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">State context</p>
          <h2>State timeline readiness</h2>
        </div>
      </div>
      <div className="state-timeline">
        {sampleStateTimeline.map((item) => (
          <span key={item.state} style={{ width: `${item.width}%` }}>{item.state}</span>
        ))}
      </div>
      <p className="muted-copy">The evaluator is state-aware; actual state transitions will be populated by the parser layer.</p>
    </section>
  );
}
