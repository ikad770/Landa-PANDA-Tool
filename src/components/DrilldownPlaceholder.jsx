import { mockFindings } from '../data/sampleMachines.js';
import { rulesForSystem } from '../services/ruleEngine.js';
import { formatList } from '../utils/formatters.js';

export default function DrilldownPlaceholder({ machine, selectedSystem, rules }) {
  const matchingRules = rulesForSystem(rules, selectedSystem);
  const logs = machine?.logFiles?.filter((log) => !selectedSystem || log.toLowerCase().includes(selectedSystem.toLowerCase())) || [];

  return (
    <section className="card drilldown-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Machine drilldown</p>
          <h2>{machine?.id || 'No machine selected'}</h2>
        </div>
        <span className="badge">{selectedSystem || 'All systems'}</span>
      </div>
      <div className="placeholder-panel">
        <strong>Subsystem visual map pending reference image</strong>
        <span>No fake subsystem visuals are included in this foundation build.</span>
      </div>
      <div className="detail-grid">
        <div><span>Selected system</span><strong>{selectedSystem || 'All detected systems'}</strong></div>
        <div><span>Detected logs</span><strong>{logs.length}</strong></div>
        <div><span>Matching rules</span><strong>{matchingRules.length}</strong></div>
        <div><span>Detected systems</span><strong>{formatList(machine?.detectedSystems || [])}</strong></div>
      </div>
      <div className="split-list">
        <div>
          <h3>Mock findings</h3>
          {mockFindings.map((finding) => <p key={finding}>{finding}</p>)}
        </div>
        <div>
          <h3>Evidence list</h3>
          {(machine?.sampleLogs || []).slice(0, 5).map((log) => <code key={log}>{log}</code>)}
          {!machine?.sampleLogs?.length && <p className="muted-copy">No log evidence available before upload.</p>}
        </div>
      </div>
    </section>
  );
}
