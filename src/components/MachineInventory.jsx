import { formatList } from '../utils/formatters.js';

export default function MachineInventory({ machines, onSelectMachine, selectedMachineId }) {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Machines</p>
          <h2>Machine inventory</h2>
        </div>
      </div>
      {machines.length === 0 ? (
        <div className="empty-state">No machines detected yet. Upload a machine zip, opc.zip, folder, or multiple archives to build the inventory.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Machine</th><th>Status</th><th>Systems</th><th>OPC</th><th>Logs</th><th>Warnings</th></tr>
            </thead>
            <tbody>
              {machines.map((machine) => (
                <tr key={machine.id} className={selectedMachineId === machine.id ? 'selected-row' : ''} onClick={() => onSelectMachine(machine.id)}>
                  <td><strong>{machine.id}</strong></td>
                  <td>{machine.status}</td>
                  <td>{formatList(machine.detectedSystems)}</td>
                  <td>{machine.opcArchives.length}</td>
                  <td>{machine.logFiles.length}</td>
                  <td>{machine.scanWarnings.length || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
