import { systemCatalog } from '../data/systemCatalog.js';

export default function MachineServiceMap({ machines }) {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Coverage</p>
          <h2>System coverage by machine</h2>
        </div>
      </div>
      {machines.length === 0 ? (
        <div className="empty-state">Coverage appears after upload scanning detects system paths.</div>
      ) : (
        <div className="coverage-grid">
          <div className="coverage-head">Machine</div>
          {systemCatalog.map((system) => <div className="coverage-head" key={system.key}>{system.key}</div>)}
          {machines.map((machine) => (
            <FragmentRow key={machine.id} machine={machine} />
          ))}
        </div>
      )}
    </section>
  );
}

function FragmentRow({ machine }) {
  return (
    <>
      <div className="coverage-machine">{machine.id}</div>
      {systemCatalog.map((system) => (
        <div className={machine.detectedSystems.includes(system.key) ? 'coverage-cell detected' : 'coverage-cell'} key={system.key}>
          {machine.detectedSystems.includes(system.key) ? 'Detected' : '—'}
        </div>
      ))}
    </>
  );
}
