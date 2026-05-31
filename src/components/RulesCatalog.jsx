import { formatDuration, formatRange } from '../utils/formatters.js';

export default function RulesCatalog({ rules }) {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Rules</p>
          <h2>Rules catalog</h2>
        </div>
        <span className="badge">Excel import pending</span>
      </div>
      <div className="table-wrap">
        <table className="data-table rules-table">
          <thead>
            <tr>
              <th>ID</th><th>System</th><th>Component</th><th>Signal</th><th>States</th><th>Target</th><th>Warning</th><th>Critical</th><th>Duration / Grace</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td><strong>{rule.id}</strong><small>{rule.sourceLog}</small></td>
                <td>{rule.system}</td>
                <td>{rule.component}</td>
                <td>{rule.signalName}</td>
                <td>{rule.applicableStates.join(', ')}</td>
                <td>{rule.target} {rule.unit}</td>
                <td>{formatRange(rule.warningLow, rule.warningHigh, rule.unit)}</td>
                <td>{formatRange(rule.criticalLow, rule.criticalHigh, rule.unit)}</td>
                <td>{formatDuration(rule.allowedDurationSec)} / {formatDuration(rule.transitionGraceSec)}</td>
                <td>{rule.recommendedAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
