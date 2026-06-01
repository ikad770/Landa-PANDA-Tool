import { useMemo, useState } from 'react';
import Layout from './components/Layout.jsx';
import KpiCard from './components/KpiCard.jsx';
import UploadPanel from './components/UploadPanel.jsx';
import MachineInventory from './components/MachineInventory.jsx';
import MachineServiceMap from './components/MachineServiceMap.jsx';
import RulesCatalog from './components/RulesCatalog.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';
import EvidenceLog from './components/EvidenceLog.jsx';
import StateTimeline from './components/StateTimeline.jsx';
import DrilldownPlaceholder from './components/DrilldownPlaceholder.jsx';
import { sampleRules } from './data/sampleRules.js';
import { buildMockAlerts } from './services/alertBuilder.js';
import { formatNumber } from './utils/formatters.js';

const EMPTY_SCAN = {
  machines: [],
  totals: { files: 0, machines: 0, opcArchives: 0, logFiles: 0, systems: 0 },
  errors: []
};

export default function App() {
  const [activeView, setActiveView] = useState('Service Radar');
  const [scanResult, setScanResult] = useState(EMPTY_SCAN);
  const [selectedMachineId, setSelectedMachineId] = useState(null);
  const [selectedSystem, setSelectedSystem] = useState('IRD');

  const alerts = useMemo(() => buildMockAlerts(sampleRules), []);
  const selectedMachine = scanResult.machines.find((machine) => machine.id === selectedMachineId) || scanResult.machines[0] || null;
  const evidenceEntries = useMemo(() => alerts.map((alert) => alert.evidence), [alerts]);

  function handleScanComplete(result) {
    setScanResult(result);
    setSelectedMachineId(result.machines[0]?.id || null);
  }

  return (
    <Layout activeView={activeView} onNavigate={setActiveView} sessionName="Session-001" hasData={scanResult.machines.length > 0}>
      {activeView === 'Service Radar' && (
        <ServiceRadar
          scanResult={scanResult}
          onScanComplete={handleScanComplete}
          selectedMachineId={selectedMachine?.id}
          onSelectMachine={setSelectedMachineId}
          alerts={alerts}
        />
      )}
      {activeView === 'Upload Logs' && (
        <UploadLogs scanResult={scanResult} onScanComplete={handleScanComplete} onSelectMachine={setSelectedMachineId} selectedMachineId={selectedMachine?.id} />
      )}
      {activeView === 'Rules Catalog' && <RulesCatalog rules={sampleRules} />}
      {activeView === 'Machines' && (
        <div className="stack">
          <MachineInventory machines={scanResult.machines} onSelectMachine={setSelectedMachineId} selectedMachineId={selectedMachine?.id} />
          <SystemSelector selectedSystem={selectedSystem} onSelectSystem={setSelectedSystem} />
          <DrilldownPlaceholder machine={selectedMachine} selectedSystem={selectedSystem} rules={sampleRules} />
        </div>
      )}
      {activeView === 'Alerts' && <AlertsPanel alerts={alerts} />}
      {activeView === 'Settings' && <SettingsFoundation />}
    </Layout>
  );
}

function ServiceRadar({ scanResult, onScanComplete, selectedMachineId, onSelectMachine, alerts }) {
  return (
    <div className="stack">
      <section className="kpi-grid">
        <KpiCard label="Machines detected" value={formatNumber(scanResult.totals.machines)} detail="From folder or archive paths" />
        <KpiCard label="OPC archives" value={formatNumber(scanResult.totals.opcArchives)} detail="Includes nested opc.zip" />
        <KpiCard label="Log files" value={formatNumber(scanResult.totals.logFiles)} detail="Inventory only for now" />
        <KpiCard label="Systems detected" value={formatNumber(scanResult.totals.systems)} detail="BSS, IRD, IPS, FEC, ECC, LLCI, DPS, QCS" />
        <KpiCard label="Rules loaded" value={formatNumber(sampleRules.length)} detail="Sample catalog model" />
      </section>
      <div className="two-column">
        <UploadPanel scanResult={scanResult} onScanComplete={onScanComplete} compact />
        <RuleReadiness />
      </div>
      <MachineInventory machines={scanResult.machines} onSelectMachine={onSelectMachine} selectedMachineId={selectedMachineId} />
      <div className="two-column wide-left">
        <MachineServiceMap machines={scanResult.machines} />
        <AlertsPanel alerts={alerts} />
      </div>
    </div>
  );
}

function UploadLogs({ scanResult, onScanComplete, onSelectMachine, selectedMachineId }) {
  return (
    <div className="stack">
      <UploadPanel scanResult={scanResult} onScanComplete={onScanComplete} />
      <MachineInventory machines={scanResult.machines} onSelectMachine={onSelectMachine} selectedMachineId={selectedMachineId} />
      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">Warnings</p><h2>Per-machine scan details</h2></div></div>
        {scanResult.machines.length === 0 ? <div className="empty-state">Scan details are empty before upload.</div> : scanResult.machines.map((machine) => (
          <article className="scan-detail" key={machine.id}>
            <strong>{machine.id}</strong>
            <span>Sources: {machine.sourceFiles.length} · OPC: {machine.opcArchives.length} · Logs: {machine.logFiles.length}</span>
            {machine.scanWarnings.length > 0 ? machine.scanWarnings.map((warning) => <p key={warning}>{warning}</p>) : <p>No warnings for this inventory.</p>}
          </article>
        ))}
      </section>
    </div>
  );
}

function RuleReadiness() {
  return (
    <section className="card">
      <div className="section-heading"><div><p className="eyebrow">Readiness</p><h2>Rule engine foundation</h2></div></div>
      <div className="readiness-list">
        <span>Structured rule model loaded</span>
        <span>State-aware evaluator implemented</span>
        <span>Alert builder model implemented</span>
        <span>Excel import parser placeholder pending</span>
      </div>
      <StateTimeline />
    </section>
  );
}

function SystemSelector({ selectedSystem, onSelectSystem }) {
  const systems = ['BSS', 'IRD', 'IPS', 'FEC', 'ECC', 'LLCI', 'DPS', 'QCS'];
  return (
    <section className="card compact-card">
      <div className="button-row wrap">
        {systems.map((system) => <button key={system} className={selectedSystem === system ? 'active-button' : ''} onClick={() => onSelectSystem(system)} type="button">{system}</button>)}
      </div>
    </section>
  );
}

function SettingsFoundation() {
  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">Settings</p><h2>Product foundation status</h2></div></div>
        <div className="readiness-list">
          <span>Vite entrypoint fixed</span>
          <span>Dependencies pinned in package.json</span>
          <span>No favicon or binary asset requirement</span>
          <span>Parser, rule engine, and alert services separated from UI</span>
        </div>
      </section>
      <EvidenceLog entries={[]} />
    </div>
  );
}
