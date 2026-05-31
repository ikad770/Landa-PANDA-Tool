import React, { Component, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import './styles.css';


class UiErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Landa PANDA Tool UI failed to initialize', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <FallbackPage error={this.state.error} />;
    }

    return this.props.children;
  }
}

function FallbackPage({ error }) {
  const message = error?.message || String(error || 'Unknown error');

  return (
    <main className="fallback-page" role="alert">
      <section className="fallback-card">
        <div className="brand-mark">P</div>
        <h1>Landa PANDA Tool loaded, but UI failed to initialize</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

const SYSTEM_DETECTORS = [
  { key: 'BSS', label: 'BSS / Blanket', terms: ['bss', 'blanket', 'bcu', 'seam', 'dancer'] },
  { key: 'IRD', label: 'IRD / Imaging', terms: ['ird', 'ipu', 'air heating', 'air cooling', 'pressure valve', 'vacuum valve'] },
  { key: 'IPS', label: 'IPS / Ink Process', terms: ['ips', 'ink', 'circulation', 'pump', 'pressure', 'tank'] },
  { key: 'FEC', label: 'FEC / Feeder', terms: ['fec', 'feeder'] },
  { key: 'ECC', label: 'ECC / Engine Control', terms: ['ecc', 'engine'] },
  { key: 'LLCI', label: 'LLCI / Laydown', terms: ['llci', 'laydown'] },
  { key: 'DPS', label: 'DPS / Print Heads', terms: ['dps', 'ph voltage', 'missing nozzles', 'waveform'] },
  { key: 'QCS', label: 'QCS / Inspection', terms: ['qcs', 'inspection', 'registration', 'correction'] }
];

const SAMPLE_RULES = [
  { id: 'PSS-AIR-HEAT-READY', system: 'IRD', parameter: 'Air Heating Target Temp', state: 'Ready', target: 56, unit: '°C', warning: '±10', working: '±5', graceSec: 60 },
  { id: 'IRD-PID-READY', system: 'IRD', parameter: 'IRD PID 8-9', state: 'Ready', target: 130, unit: '%', warning: '+10 / -30', working: '±2', graceSec: 90 },
  { id: 'NPD-HIGH-PRESSURE', system: 'DPS', parameter: 'NPD High Pressure', state: 'Ready', target: 6, unit: 'bar', warning: '±0.1', working: '±0.1', graceSec: 30 },
  { id: 'BSS-BLANKET-TENSION-STANDBY', system: 'BSS', parameter: 'Blanket tension at standby', state: 'Standby', target: 400, unit: 'N', warning: 'config', working: 'config', graceSec: 180 },
  { id: 'BSS-BLANKET-READY-SPEED', system: 'BSS', parameter: 'Blanket ready speed', state: 'Ready', target: 6500, unit: 'SPH', warning: 'config', working: 'config', graceSec: 180 },
  { id: 'IPS-CIRC-PUMP-WARN', system: 'IPS', parameter: 'Circulation pump speed', state: 'Ready / Printing', target: '11–26', unit: 'speed', warning: 'min/max', working: 'min/max', graceSec: 45 },
  { id: 'IPS-INK-PRESSURE-ERROR', system: 'IPS', parameter: 'Ink Pressure', state: 'Ready / Printing', target: '-95 to -55', unit: 'mbar', warning: 'high/low', working: 'high/low', graceSec: 45 },
  { id: 'QCS-VALID-WINDOW', system: 'QCS', parameter: 'Correction valid window', state: 'Printing', target: 800, unit: 'µm', warning: 'config', working: 'config', graceSec: 0 }
];

const EMPTY_ANALYSIS = {
  machines: [],
  files: 0,
  logs: 0,
  opcArchives: 0,
  nestedArchives: 0,
  systems: new Set(),
  errors: []
};

function normalizePath(path) {
  return String(path || '').replaceAll('\\\\', '/').replaceAll('\\', '/');
}

function machineFromPath(path) {
  const parts = normalizePath(path).split('/').filter(Boolean);
  const direct = parts.find((part) => /^[SD]\d{6,}$/i.test(part));
  if (direct) return direct.toUpperCase();
  const zipLike = parts.find((part) => /^[SD]\d{6,}.*\.zip$/i.test(part));
  if (zipLike) return zipLike.replace(/\.zip$/i, '').toUpperCase();
  return parts[0] || 'UNKNOWN_MACHINE';
}

function detectSystemsFromPath(path) {
  const lower = normalizePath(path).toLowerCase();
  const result = [];
  for (const system of SYSTEM_DETECTORS) {
    if (system.terms.some((term) => lower.includes(term))) result.push(system.key);
  }
  return result.length ? result : ['UNKNOWN'];
}

function isLogEntry(path) {
  const lower = normalizePath(path).toLowerCase();
  return lower.includes('/logs/') || lower.startsWith('logs/') || lower.includes('opc/logs/');
}

function isZipName(name) {
  return String(name || '').toLowerCase().endsWith('.zip');
}

function mergeMachine(map, machineId, patch) {
  const current = map.get(machineId) || {
    id: machineId,
    sourceFiles: 0,
    logFiles: 0,
    opcArchives: 0,
    nestedArchives: 0,
    systems: new Set(),
    sampleLogs: [],
    status: 'Pending'
  };
  if (patch.sourceFiles) current.sourceFiles += patch.sourceFiles;
  if (patch.logFiles) current.logFiles += patch.logFiles;
  if (patch.opcArchives) current.opcArchives += patch.opcArchives;
  if (patch.nestedArchives) current.nestedArchives += patch.nestedArchives;
  if (patch.systems) patch.systems.forEach((s) => current.systems.add(s));
  if (patch.sampleLog && current.sampleLogs.length < 6) current.sampleLogs.push(patch.sampleLog);
  current.status = current.logFiles > 0 ? 'Ready for mapping' : 'No logs detected';
  map.set(machineId, current);
}

async function scanZipBlob(blob, visibleName, machineMap, global, depth = 0) {
  if (depth > 4) return;
  let zip;
  try {
    zip = await JSZip.loadAsync(blob);
  } catch (error) {
    global.errors.push(`Could not read zip: ${visibleName}`);
    return;
  }

  const baseMachine = machineFromPath(visibleName);
  const entries = Object.values(zip.files);
  const isOpc = /(^|\/)opc(\.zip)?$/i.test(visibleName) || visibleName.toLowerCase().includes('/opc.zip') || visibleName.toLowerCase().endsWith('opc.zip');
  if (isOpc) {
    global.opcArchives += 1;
    mergeMachine(machineMap, baseMachine, { opcArchives: 1 });
  }

  for (const entry of entries) {
    if (entry.dir) continue;
    const entryPath = normalizePath(`${visibleName}/${entry.name}`);
    global.files += 1;

    if (isLogEntry(entryPath)) {
      const systems = detectSystemsFromPath(entryPath);
      global.logs += 1;
      systems.forEach((s) => global.systems.add(s));
      mergeMachine(machineMap, baseMachine, { logFiles: 1, systems, sampleLog: entryPath });
    }

    if (isZipName(entry.name)) {
      global.nestedArchives += 1;
      mergeMachine(machineMap, baseMachine, { nestedArchives: 1 });
      const nestedBlob = await entry.async('blob');
      await scanZipBlob(nestedBlob, entryPath, machineMap, global, depth + 1);
    }
  }
}

async function analyzeFiles(fileList) {
  const files = Array.from(fileList || []);
  const machineMap = new Map();
  const global = { ...EMPTY_ANALYSIS, systems: new Set(), errors: [] };

  for (const file of files) {
    const rel = normalizePath(file.webkitRelativePath || file.name);
    const machine = machineFromPath(rel);
    mergeMachine(machineMap, machine, { sourceFiles: 1 });

    if (isLogEntry(rel)) {
      const systems = detectSystemsFromPath(rel);
      global.logs += 1;
      systems.forEach((s) => global.systems.add(s));
      mergeMachine(machineMap, machine, { logFiles: 1, systems, sampleLog: rel });
    }

    if (isZipName(file.name)) {
      await scanZipBlob(file, rel, machineMap, global, 0);
    }
  }

  return {
    machines: Array.from(machineMap.values()).map((m) => ({ ...m, systems: Array.from(m.systems).sort() })),
    files: global.files + files.length,
    logs: global.logs,
    opcArchives: global.opcArchives,
    nestedArchives: global.nestedArchives,
    systems: Array.from(global.systems).sort(),
    errors: global.errors
  };
}

function App() {
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [view, setView] = useState('service');

  const machines = analysis?.machines || [];
  const activeMachine = selectedMachine || machines[0] || null;
  const criticalAlerts = activeMachine?.systems?.includes('BSS') ? 1 : 0;

  async function handleFiles(event) {
    const selected = event.target.files;
    if (!selected || selected.length === 0) return;
    setBusy(true);
    try {
      const result = await analyzeFiles(selected);
      setAnalysis(result);
      setSelectedMachine(result.machines[0] || null);
    } catch (error) {
      console.error(error);
      setAnalysis({ ...EMPTY_ANALYSIS, systems: [], errors: [error.message] });
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-title">PANDA Tool</div>
            <div className="brand-subtitle">Proactive Analyzer Notification DA</div>
          </div>
        </div>
        <nav className="nav-list">
          {['service', 'upload', 'rules', 'machines', 'settings'].map((item) => (
            <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>
              {item === 'service' ? 'Service Radar' : item === 'upload' ? 'Upload Logs' : item === 'rules' ? 'Rules Catalog' : item === 'machines' ? 'Machines' : 'Settings'}
            </button>
          ))}
        </nav>
        <div className="side-card">
          <div className="side-title">Config source</div>
          <span className="pill good">Converted PDF v0.4</span>
          <p>Rules catalog is loaded from the converted parameter structure and ready for Excel cleanup.</p>
        </div>
        <div className="side-card">
          <div className="side-title">Accepted input</div>
          <p>Upload a machine ZIP, a full machine folder, or a root folder containing multiple machine folders.</p>
        </div>
      </aside>

      <main className="main">
        <Header />
        {view === 'service' && <ServiceRadar analysis={analysis} activeMachine={activeMachine} criticalAlerts={criticalAlerts} setView={setView} setSelectedMachine={setSelectedMachine} />}
        {view === 'upload' && <UploadPanel busy={busy} onFiles={handleFiles} analysis={analysis} setSelectedMachine={setSelectedMachine} setView={setView} />}
        {view === 'rules' && <RulesCatalog />}
        {view === 'machines' && <MachinesPanel analysis={analysis} setSelectedMachine={setSelectedMachine} setView={setView} />}
        {view === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">Landa Digital Printing</div>
        <h1>Service Early Warning Platform</h1>
      </div>
      <div className="top-actions">
        <span className="pill">SW 9.2 rules</span>
        <span className="pill good">Engine ready</span>
        <div className="avatar">JD</div>
      </div>
    </header>
  );
}

function ServiceRadar({ analysis, activeMachine, criticalAlerts, setView, setSelectedMachine }) {
  const systemCount = analysis?.systems?.length || 0;
  const machines = analysis?.machines || [];
  return (
    <div className="page-grid">
      <section className="kpi-grid full">
        <Kpi title="Machines loaded" value={machines.length || '—'} hint="Multi-machine upload ready" />
        <Kpi title="OPC archives" value={analysis?.opcArchives ?? '—'} hint="Nested ZIP scan" />
        <Kpi title="Log files found" value={analysis?.logs ?? '—'} hint="opc.zip → logs" />
        <Kpi title="Systems detected" value={systemCount || '—'} hint="BSS / IPS / IRD / etc." />
        <Kpi title="Mock P1 alerts" value={criticalAlerts || 0} hint="Rules engine placeholder" danger={criticalAlerts > 0} />
      </section>

      <section className="card machine-card wide">
        <div className="section-head">
          <div>
            <h2>Machine Service Map {activeMachine ? `· ${activeMachine.id}` : ''}</h2>
            <p>Upload logs to populate systems. Hotspots are driven by detected log folders and rule context.</p>
          </div>
          <button className="primary" onClick={() => setView('upload')}>Upload machine logs</button>
        </div>
        <MachineMap activeMachine={activeMachine} onSystemClick={() => setView('rules')} />
      </section>

      <section className="card issue-card">
        <div className="issue-kicker">Active issue</div>
        <h2>{activeMachine ? 'BSS · Blanket System' : 'No machine selected'}</h2>
        <p>{activeMachine ? 'State-aware rule evaluation is ready. Real alerts will appear after log-to-signal mapping is completed.' : 'Upload logs to start analysis.'}</p>
        <div className="metric-grid">
          <Metric label="State context" value="Printing" />
          <Metric label="Duration" value="22m 14s" />
          <Metric label="Confidence" value="96%" />
          <Metric label="Severity" value={criticalAlerts ? 'P1 High' : 'None'} danger={criticalAlerts > 0} />
        </div>
        <MiniChart />
        <button className="primary wide-button" onClick={() => setView('rules')}>Open rule evidence</button>
      </section>

      <section className="card">
        <h3>Machines</h3>
        <div className="machine-list">
          {machines.length === 0 && <Empty text="No uploaded machines yet." />}
          {machines.map((machine) => (
            <button key={machine.id} className="machine-row" onClick={() => setSelectedMachine(machine)}>
              <span>{machine.id}</span>
              <small>{machine.logFiles} logs · {machine.systems.join(', ') || 'No systems'}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>State timeline</h3>
        <StateTimeline />
      </section>

      <section className="card">
        <h3>Evidence log</h3>
        <EvidenceLog />
      </section>
    </div>
  );
}

function UploadPanel({ busy, onFiles, analysis, setSelectedMachine, setView }) {
  return (
    <div className="upload-layout">
      <section className="card upload-hero">
        <div className="section-head">
          <div>
            <h2>Upload PANDA log package</h2>
            <p>The scanner accepts ZIPs, nested autocollect ZIPs, opc.zip, logs folders, or a root folder containing multiple machines.</p>
          </div>
          {busy && <span className="pill warn">Scanning...</span>}
        </div>
        <div className="drop-grid">
          <label className="drop-zone">
            <input type="file" multiple accept=".zip" onChange={onFiles} />
            <b>Upload ZIP files</b>
            <span>Machine zip / autocollect zip / root zip</span>
          </label>
          <label className="drop-zone">
            <input type="file" multiple webkitdirectory="true" directory="true" onChange={onFiles} />
            <b>Upload folder</b>
            <span>Root folder with S*/D* machine folders</span>
          </label>
        </div>
      </section>

      <section className="card">
        <h3>Expected folder structure</h3>
        <pre className="tree">{`Root folder\n├── S100100025\n│   └── autocollect.zip\n│       └── opc.zip\n│           └── logs/\n├── S100100026\n│   └── ...\n└── D110100023\n    └── ...`}</pre>
      </section>

      <section className="card full">
        <h3>Scan result</h3>
        {!analysis && <Empty text="Upload logs to see scan results." />}
        {analysis && (
          <div className="result-grid">
            <Kpi title="Files scanned" value={analysis.files} hint="Including nested archives" />
            <Kpi title="Log files" value={analysis.logs} hint="Detected under logs/" />
            <Kpi title="OPC archives" value={analysis.opcArchives} hint="Found opc.zip" />
            <Kpi title="Nested ZIPs" value={analysis.nestedArchives} hint="Recursive scan" />
          </div>
        )}
        {analysis?.machines?.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Machine</th><th>Status</th><th>Source files</th><th>Logs</th><th>OPC</th><th>Systems</th><th>Action</th></tr></thead>
            <tbody>
              {analysis.machines.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td><td><span className="pill good">{m.status}</span></td><td>{m.sourceFiles}</td><td>{m.logFiles}</td><td>{m.opcArchives}</td><td>{m.systems.join(', ')}</td>
                  <td><button className="ghost" onClick={() => { setSelectedMachine(m); setView('service'); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {analysis?.errors?.length > 0 && <div className="error-box">{analysis.errors.map((e) => <div key={e}>{e}</div>)}</div>}
      </section>
    </div>
  );
}

function RulesCatalog() {
  return (
    <div className="page-grid">
      <section className="card full">
        <div className="section-head">
          <div>
            <h2>Rules Catalog</h2>
            <p>Initial state-aware rules from the converted parameter file. Excel import will replace this mock catalog.</p>
          </div>
          <span className="pill good">{SAMPLE_RULES.length} rules loaded</span>
        </div>
        <table className="data-table">
          <thead><tr><th>Rule ID</th><th>System</th><th>Parameter</th><th>State</th><th>Target</th><th>Unit</th><th>Warning</th><th>Grace</th></tr></thead>
          <tbody>{SAMPLE_RULES.map((rule) => <tr key={rule.id}><td>{rule.id}</td><td>{rule.system}</td><td>{rule.parameter}</td><td>{rule.state}</td><td>{rule.target}</td><td>{rule.unit}</td><td>{rule.warning}</td><td>{rule.graceSec}s</td></tr>)}</tbody>
        </table>
      </section>
      <section className="card wide">
        <h3>Rule evaluation model</h3>
        <div className="logic-flow"><span>Log signal</span><b>+</b><span>Machine State</span><b>+</b><span>Excel Rule</span><b>+</b><span>Duration</span><b>+</b><span>Grace window</span><b>=</b><span>Alert</span></div>
      </section>
      <section className="card">
        <h3>Next mapping needed</h3>
        <p>To make alerts real, each rule needs the exact log signal name from opc/logs. Example: parameter name → FECNotifications/IPSNotifications numeric field.</p>
      </section>
    </div>
  );
}

function MachinesPanel({ analysis, setSelectedMachine, setView }) {
  return <UploadPanel busy={false} onFiles={() => {}} analysis={analysis} setSelectedMachine={setSelectedMachine} setView={setView} />;
}

function SettingsPanel() {
  return (
    <section className="card full-card">
      <h2>Settings</h2>
      <p>Future settings: Excel rules import, severity thresholds, transition grace periods, owners, sites, notification channels.</p>
    </section>
  );
}

function Kpi({ title, value, hint, danger }) {
  return <div className={`kpi ${danger ? 'danger' : ''}`}><div className="kpi-title">{title}</div><div className="kpi-value">{value}</div><div className="kpi-hint">{hint}</div></div>;
}
function Metric({ label, value, danger }) { return <div className="metric"><small>{label}</small><b className={danger ? 'danger-text' : ''}>{value}</b></div>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }

function MachineMap({ activeMachine }) {
  const systems = new Set(activeMachine?.systems || []);
  const all = ['IRD', 'FEC', 'IPS', 'ECC', 'LLCI', 'BSS'];
  return (
    <div className="machine-stage">
      <svg viewBox="0 0 1100 330" className="machine-svg" aria-label="Landa machine service map">
        <defs>
          <linearGradient id="body" x1="0" x2="1"><stop offset="0" stopColor="#f7fbff"/><stop offset="0.48" stopColor="#d7dde6"/><stop offset="1" stopColor="#818996"/></linearGradient>
          <linearGradient id="dark" x1="0" x2="1"><stop offset="0" stopColor="#1f2937"/><stop offset="1" stopColor="#0d121a"/></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <ellipse cx="555" cy="290" rx="470" ry="28" fill="#000" opacity="0.55"/>
        <path d="M95 154 C95 115 123 96 171 96 H395 C442 96 462 117 462 154 V238 H96 Z" fill="url(#body)"/>
        <rect x="123" y="121" width="302" height="62" rx="12" fill="#04070a"/>
        <rect x="139" y="134" width="64" height="33" fill="#6e9664" opacity="0.85"/><rect x="211" y="134" width="58" height="33" fill="#273241"/><rect x="279" y="134" width="58" height="33" fill="#273241"/><rect x="347" y="134" width="58" height="33" fill="#273241"/>
        <path d="M167 205 H460 V256 H167 Z" fill="#1c2530"/><path d="M222 183 L357 183 L425 239 H155 Z" fill="#f4f7fb"/><path d="M248 196 L337 196 L376 224 H209 Z" fill="#ef7f86"/>
        <path d="M463 112 L807 92 C866 89 910 121 916 177 L916 236 H462 Z" fill="url(#dark)" stroke="#2d3745" strokeWidth="4"/>
        <rect x="501" y="128" width="355" height="48" fill="#0a0f16" opacity="0.85"/><path d="M510 171 H875" stroke="#28bdf7" strokeWidth="5" filter="url(#glow)"/>
        <path d="M920 139 H1028 C1050 139 1060 151 1060 171 V235 H916 V164 C916 149 920 139 920 139Z" fill="url(#body)"/>
        <rect x="954" y="158" width="56" height="57" rx="8" fill="#111923"/>
        <rect x="175" y="256" width="7" height="45" fill="#5b6472"/><rect x="367" y="256" width="7" height="45" fill="#5b6472"/><rect x="589" y="236" width="7" height="58" fill="#5b6472"/><rect x="884" y="236" width="7" height="58" fill="#5b6472"/>
        <path d="M150 260 H1010" stroke="#0a0d12" strokeWidth="3"/>
      </svg>
      {all.map((sys, index) => <Hotspot key={sys} sys={sys} active={systems.has(sys) || sys === 'BSS'} index={index} />)}
      <div className="map-legend"><span className="dot red"/> Active issue <span className="dot cyan"/> Detected system <span className="dot muted"/> Pending mapping</div>
    </div>
  );
}
function Hotspot({ sys, active, index }) {
  const pos = {
    IRD: [23, 30], FEC: [42, 22], IPS: [57, 26], ECC: [71, 18], LLCI: [86, 30], BSS: [52, 61]
  }[sys];
  const isIssue = sys === 'BSS';
  return <button className={`hotspot ${active ? 'active' : ''} ${isIssue ? 'issue' : ''}`} style={{ left: `${pos[0]}%`, top: `${pos[1]}%` }}><span/>{sys}<small>{SYSTEM_DETECTORS.find(s => s.key === sys)?.label.split('/')[1]?.trim() || ''}</small></button>;
}
function MiniChart() { return <svg viewBox="0 0 360 120" className="mini-chart"><path d="M10 75 C50 66 80 90 120 72 S190 68 210 70 S230 20 260 42 S310 60 350 55" fill="none" stroke="#ff5266" strokeWidth="4"/><path d="M10 70 H350" stroke="#4bd1ff" strokeDasharray="5 7"/><path d="M10 92 H350" stroke="#4bd1ff" strokeDasharray="5 7" opacity=".45"/><line x1="220" y1="18" x2="220" y2="105" stroke="#ff5266" strokeDasharray="4 6"/></svg>; }
function StateTimeline() { return <div className="timeline"><span>Standby</span><span className="ready">Ready</span><span className="prep">Prepare</span><span className="print">Printing</span><span className="end">PrintEnd</span><span className="ready">Ready</span><span className="print">Printing</span></div>; }
function EvidenceLog() { const rows = ['13:47:01  StateMachine  State changed to Printing','13:47:05  FECNotifications  BSS pressure deviation detected','13:47:06  RulesEngine  BSS rule triggered P1','13:47:07  Correlation  State context confirmed']; return <div className="evidence">{rows.map((r) => <div key={r}>{r}</div>)}</div>; }

function renderFallback(error) {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = '';
  createRoot(root).render(<FallbackPage error={error} />);
}

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root was not found in index.html');
  }

  createRoot(rootElement).render(
    <UiErrorBoundary>
      <App />
    </UiErrorBoundary>
  );
} catch (error) {
  console.error('Landa PANDA Tool failed before React could mount', error);
  renderFallback(error);
}
