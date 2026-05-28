import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  DatabaseZap,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Layers3,
  Menu,
  Move3D,
  RadioTower,
  Search,
  Settings2,
  Share2,
  UploadCloud,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';

const machineHotspots = [
  {
    id: 'ird', label: 'IRD', sub: 'Imaging', x: 20, y: 37, severity: 'normal', status: 'Normal',
    issue: 'No active issue', confidence: 97, duration: '—', state: 'Ready', actual: 'Stable', expected: 'Dynamic band',
  },
  {
    id: 'fec', label: 'FEC', sub: 'Feeder', x: 37, y: 34, severity: 'normal', status: 'Normal',
    issue: 'No active issue', confidence: 95, duration: '—', state: 'Ready', actual: 'Stable', expected: 'Dynamic band',
  },
  {
    id: 'ips', label: 'IPS', sub: 'Ink Process', x: 49, y: 37, severity: 'normal', status: 'Normal',
    issue: 'Pump speed stable', confidence: 94, duration: '—', state: 'Printing', actual: '98', expected: '92–104',
  },
  {
    id: 'ecc', label: 'ECC', sub: 'Engine Control', x: 61, y: 32, severity: 'normal', status: 'Normal',
    issue: 'State sync healthy', confidence: 92, duration: '—', state: 'Prepare2Print', actual: 'OK', expected: '< 10s delay',
  },
  {
    id: 'llci', label: 'LLCI', sub: 'Laydown', x: 74, y: 38, severity: 'normal', status: 'Normal',
    issue: 'No active issue', confidence: 96, duration: '—', state: 'Printing', actual: 'Stable', expected: 'Dynamic band',
  },
  {
    id: 'bss', label: 'BSS', sub: 'Blanket System', x: 48, y: 64, severity: 'critical', status: 'P1',
    issue: 'Blanket Pressure Deviation', confidence: 96, duration: '22m 14s', state: 'Printing', actual: '420–568 psi', expected: '300–380 psi band',
  },
];

const componentNodes = [
  { name: 'Blanket Cylinder', code: 'B-CYL-01', status: 'Critical', x: 22, y: 50, score: 18, probability: 72 },
  { name: 'Pressure Sensor', code: 'B-PS-01', status: 'Warning', x: 47, y: 28, score: 42, probability: 18 },
  { name: 'Regulator', code: 'B-REG-01', status: 'Normal', x: 72, y: 35, score: 78, probability: 6 },
  { name: 'Valve Block', code: 'B-VB-01', status: 'Normal', x: 76, y: 55, score: 85, probability: 3 },
  { name: 'Air Supply', code: 'B-AIR', status: 'Normal', x: 72, y: 75, score: 88, probability: 1 },
  { name: 'Drive Motor', code: 'B-MTR-01', status: 'Normal', x: 30, y: 73, score: 90, probability: 0 },
  { name: 'Cooling Loop', code: 'B-CL-01', status: 'Normal', x: 31, y: 28, score: 92, probability: 0 },
  { name: 'Feedback Sensor', code: 'B-FB-01', status: 'Normal', x: 51, y: 72, score: 93, probability: 0 },
];

const evidenceLogs = [
  ['13:47:02', 'StateMachine', 'State changed to: Printing'],
  ['13:47:05', 'FECNotifications', 'BSS Blanket pressure high deviation detected'],
  ['13:47:06', 'RulesEngine', 'Rule R-BSS-001 triggered (severity: P1)'],
  ['13:47:06', 'Correlation', 'Correlated with state: Printing (confidence: 0.96)'],
  ['13:47:07', 'FECNotifications', 'Pressure spike count in last 5 min: 18'],
];

const relatedRules = [
  ['BSS-OUT', 'BSS blanket pressure out of band', 'P1', 'Triggered'],
  ['BSS-DROP', 'BSS pressure drop rate high', 'P2', 'Not Triggered'],
  ['BSS-SPIKE', 'BSS pressure spike detected', 'P2', 'Triggered'],
  ['BSS-RECOV', 'BSS pressure failed to recover', 'P3', 'Not Triggered'],
];

function cls(...items) { return items.filter(Boolean).join(' '); }

function KpiCard({ icon: Icon, label, value, sub, tone = 'cyan', spark }) {
  return (
    <section className="kpi-card">
      <div className={cls('kpi-icon', tone)}><Icon size={22} /></div>
      <div className="kpi-content">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-sub">{sub}</div>
      </div>
      {spark && <MiniSparkline />}
    </section>
  );
}

function MiniSparkline() {
  const points = '0,35 20,34 38,29 58,31 78,25 102,22 120,27 140,18 160,26 178,15 196,20';
  return (
    <svg viewBox="0 0 200 48" className="sparkline" aria-hidden="true">
      <path d={`M${points}`} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="brand-wrap">
        <Menu size={22} className="muted" />
        <div className="landa-logo">Landa</div>
        <div className="brand-divider" />
        <div>
          <div className="brand-title">PANDA Tool</div>
          <div className="brand-subtitle">Proactive Analyzer Notification DA</div>
        </div>
      </div>
      <nav className="nav-tabs">
        {['Service Radar', 'Alerts', 'Analysis', 'Machines', 'Reports', 'Knowledge'].map((item, idx) => (
          <button key={item} className={idx === 0 ? 'active' : ''}>{item}</button>
        ))}
      </nav>
      <div className="top-actions">
        <button className="date-picker"><CalendarDays size={16} />May 27, 2025&nbsp;&nbsp;11:10 – 14:10<ChevronDown size={16} /></button>
        <button className="icon-btn has-badge"><Bell size={18} /><span>3</span></button>
        <button className="avatar">JD</button>
      </div>
    </header>
  );
}

function MachineOverview({ selected, setSelected, openDrilldown }) {
  return (
    <section className="machine-panel">
      <div className="machine-panel-header">
        <div>
          <div className="section-label">Machine Overview</div>
          <h1>Landa S11-1P <span className="online-dot" /> <em>ONLINE</em></h1>
        </div>
        <div className="view-toggle"><span>View:</span><button className="selected"><Layers3 size={17} /></button><button><FileText size={17} /></button></div>
      </div>

      <div className="machine-stage">
        <div className="machine-bg-glow" />
        <LandaMachineSvg />
        {machineHotspots.map((h) => (
          <button
            key={h.id}
            className={cls('machine-hotspot', h.severity, selected.id === h.id && 'selected')}
            style={{ left: `${h.x}%`, top: `${h.y}%` }}
            onClick={() => setSelected(h)}
          >
            <span className="hotspot-dot" />
            <span className="hotspot-card"><b>{h.label}</b><small>{h.sub}</small></span>
          </button>
        ))}
        <div className="machine-tools">
          <button><Move3D size={16} /></button><button><Activity size={16} /></button><button><ZoomIn size={16} /></button><button><ChevronRight size={16} /></button>
        </div>
        <button className="floating-drill" onClick={openDrilldown}>Open Drill-Down <ChevronRight size={18} /></button>
      </div>
    </section>
  );
}

function LandaMachineSvg() {
  return (
    <svg className="landa-machine" viewBox="0 0 1180 420" role="img" aria-label="Landa S11 press digital twin">
      <defs>
        <linearGradient id="bodyWhite" x1="0" x2="1"><stop offset="0" stopColor="#f8fafc"/><stop offset=".55" stopColor="#d9dde2"/><stop offset="1" stopColor="#a7adb6"/></linearGradient>
        <linearGradient id="darkPanel" x1="0" x2="1"><stop offset="0" stopColor="#06080b"/><stop offset=".6" stopColor="#171c23"/><stop offset="1" stopColor="#07090c"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <ellipse cx="598" cy="376" rx="518" ry="34" fill="#000" opacity=".45" />
      <path d="M95 155 C95 123 117 108 149 108 H610 C645 108 668 129 668 164 V293 C668 325 648 342 614 342 H126 C92 342 74 323 80 290 Z" fill="url(#bodyWhite)" stroke="#e8edf4" strokeWidth="5"/>
      <rect x="126" y="135" width="512" height="118" rx="18" fill="url(#darkPanel)" stroke="#0f1720" strokeWidth="5" />
      <rect x="145" y="157" width="108" height="58" rx="6" fill="#142235" stroke="#314155" />
      <rect x="268" y="157" width="86" height="58" rx="6" fill="#111827" stroke="#314155" />
      <rect x="368" y="157" width="86" height="58" rx="6" fill="#111827" stroke="#314155" />
      <rect x="470" y="157" width="136" height="58" rx="6" fill="#101820" stroke="#314155" />
      <path d="M140 277 H620 V296 H140 Z" fill="#36bdf7" opacity=".75" filter="url(#glow)" />
      <path d="M247 251 L510 251 L582 312 L177 312 Z" fill="#f8fafc" stroke="#cfd5dd" strokeWidth="4" />
      <path d="M262 261 L498 261 L542 299 L214 299 Z" fill="#db2f3d" opacity=".72" />
      <path d="M600 148 L1036 148 C1092 148 1125 178 1130 228 L1130 298 C1126 327 1102 342 1068 342 H606 Z" fill="url(#darkPanel)" stroke="#2d333b" strokeWidth="4" />
      <path d="M620 168 L1084 168 C1106 168 1119 182 1121 206 L1122 230 L620 230 Z" fill="#242a32" opacity=".95" />
      <path d="M624 234 H1119 V251 H624 Z" fill="#38bdf8" opacity=".74" filter="url(#glow)" />
      <path d="M676 264 H1045" stroke="#414b56" strokeDasharray="14 10" strokeWidth="2" />
      <rect x="712" y="276" width="96" height="46" rx="8" fill="#12171f" stroke="#3b4450" />
      <rect x="830" y="276" width="96" height="46" rx="8" fill="#12171f" stroke="#3b4450" />
      <rect x="948" y="276" width="96" height="46" rx="8" fill="#12171f" stroke="#3b4450" />
      <path d="M662 189 H751 C780 189 800 210 800 240 V334 H664 C650 334 642 326 642 312 V205 C642 196 647 189 662 189Z" fill="#f4f4f5" stroke="#d4d9df" strokeWidth="4" />
      <rect x="694" y="210" width="72" height="84" rx="7" fill="#101820" stroke="#374151" />
      <rect x="766" y="215" width="8" height="68" rx="3" fill="#facc15" />
      <circle cx="771" cy="302" r="5" fill="#ef4444" />
      <rect x="122" y="318" width="506" height="40" rx="4" fill="#3c424b" stroke="#252a31" />
      <path d="M174 358 V388 M322 358 V388 M492 358 V388 M674 337 V388 M1054 342 V388" stroke="#52525b" strokeWidth="8" strokeLinecap="round" />
      <path d="M58 388 H1132" stroke="#17181b" strokeWidth="6" />
    </svg>
  );
}

function IssuePanel({ selected, openDrilldown }) {
  const critical = selected.severity === 'critical';
  return (
    <aside className="issue-panel">
      <div className="issue-topline"><span className={critical ? 'pulse-red' : 'pulse-green'} />{critical ? 'Active Issue' : 'Selected System'}<button><X size={16} /></button></div>
      <div className="issue-heading">
        <div><h2>{selected.label} <span>{selected.sub}</span></h2><p>{selected.issue}</p></div>
        <span className={cls('severity-badge', critical ? 'p1' : 'ok')}>{selected.status}</span>
      </div>
      <div className="summary-block">
        <h3>Summary</h3>
        <p>{critical ? 'Blanket Cylinder Pressure is above expected band repeatedly during Printing state.' : 'System is currently aligned with expected state-aware behavior.'}</p>
      </div>
      <div className="metric-grid">
        <Metric label="State Context" value={selected.state} dot="yellow" />
        <Metric label="Duration" value={selected.duration} sub={critical ? 'Since 13:47' : ''} />
        <Metric label="Confidence" value={`${selected.confidence}%`} sub={selected.confidence > 90 ? 'High' : 'Medium'} />
        <Metric label="Severity" value={selected.status} sub={critical ? 'High' : 'Normal'} danger={critical} />
      </div>
      <SignalMiniChart critical={critical} />
      <button className="primary-action" onClick={openDrilldown}>Open Drill-Down <ChevronRight size={18} /></button>
    </aside>
  );
}

function Metric({ label, value, sub, dot, danger }) {
  return <div className="metric"><span>{label}</span><b className={danger ? 'danger-text' : ''}>{dot && <i className={`dot ${dot}`} />}{value}</b>{sub && <small>{sub}</small>}</div>;
}

function SignalMiniChart({ critical = true }) {
  const { actual, upper, lower } = useMemo(() => {
    const actual = [], upper = [], lower = [];
    for (let i = 0; i <= 82; i++) {
      const band = 55 + Math.sin(i / 8) * 1.6;
      let val = band + Math.sin(i / 4) * 4;
      if (critical && i > 49) val += 19 + Math.sin(i) * 5;
      if (i > 28 && i < 38) val -= 12;
      actual.push(`${i * 4.4},${96 - val}`);
      upper.push(`${i * 4.4},${96 - (band + 10)}`);
      lower.push(`${i * 4.4},${96 - (band - 10)}`);
    }
    return { actual: actual.join(' '), upper: upper.join(' '), lower: lower.join(' ') };
  }, [critical]);
  return (
    <div className="mini-chart-card">
      <div className="chart-head"><span>Actual vs Expected</span><small>Min 420 · Max 568</small></div>
      <svg viewBox="0 0 370 110" className="mini-chart">
        <path d="M0 86 H370 M0 62 H370 M0 38 H370" stroke="rgba(255,255,255,.08)" />
        <polyline points={upper} fill="none" stroke="#3fbcef" strokeDasharray="4 5" strokeWidth="1.5" />
        <polyline points={lower} fill="none" stroke="#3fbcef" strokeDasharray="4 5" strokeWidth="1.5" />
        <polyline points={actual} fill="none" stroke={critical ? '#ff4b55' : '#44d08b'} strokeWidth="2.5" />
        {critical && <line x1="218" x2="218" y1="8" y2="96" stroke="#ff4b55" strokeDasharray="4 5" />}
      </svg>
    </div>
  );
}

function StateTimeline() {
  const states = [
    ['Standby', 9, 'standby'], ['Ready', 11, 'ready'], ['Prepare2Print', 13, 'prepare'], ['Printing', 16, 'printing'], ['PrintEnd', 11, 'printend'], ['Ready', 10, 'ready'], ['Prepare2Print', 14, 'prepare'], ['Printing', 13, 'printing'], ['PrintEnd', 10, 'printend'], ['Standby', 10, 'standby'],
  ];
  return (
    <section className="timeline-card">
      <div className="panel-title">State Machine Timeline <span>Linked to selected issue</span></div>
      <div className="timeline-strip">
        {states.map(([name, w, type], i) => <div key={i} className={type} style={{ width: `${w}%` }}><small>{name}</small></div>)}
        <div className="time-marker"><em>13:47</em></div>
      </div>
      <div className="legend-row">
        {['Standby', 'Ready', 'Prepare2Print', 'Printing', 'PrintEnd'].map((x) => <span key={x}><i className={x.toLowerCase()} />{x}</span>)}
      </div>
    </section>
  );
}

function EvidenceLog() {
  return (
    <section className="evidence-card">
      <div className="panel-title">Evidence Log <span>Latest</span></div>
      {evidenceLogs.map(([time, src, msg]) => <div className="log-row" key={time + msg}><time>{time}</time><b>{src}</b><span>{msg}</span></div>)}
    </section>
  );
}

function RecommendedActions() {
  const actions = ['Check blanket cylinder pressure sensor calibration.', 'Inspect air supply and regulator to blanket system.', 'Verify blanket cylinder for mechanical friction / debris.', 'Review recent maintenance and replacement history.'];
  return (
    <section className="actions-card">
      <div className="panel-title">Recommended Service Action</div>
      {actions.map((a, i) => <div className="action-row" key={a}><b>{i + 1}</b><span>{a}</span></div>)}
      <button className="secondary-action">View Knowledge Article <ExternalLink size={14} /></button>
    </section>
  );
}

function Drilldown({ close }) {
  const [selectedComponent, setSelectedComponent] = useState(componentNodes[0]);
  return (
    <div className="drilldown-screen">
      <header className="drill-header">
        <div>
          <div className="breadcrumbs">Machine Overview <ChevronRight size={14} /> Landa S11-1P <ChevronRight size={14} /> BSS Blanket System <ChevronRight size={14} /> <b>Component Analysis</b></div>
          <h1>BSS Blanket System — Cutaway View</h1>
          <p>Live component status, likely root cause, logs and service actions.</p>
        </div>
        <div className="drill-actions"><button onClick={close}>View Machine Overview</button><button><Share2 size={16} />Share</button><button><Download size={16} />Export</button><button className="blue">Actions <ChevronDown size={16} /></button></div>
      </header>

      <div className="drill-layout">
        <aside className="drill-left">
          <div className="context-card">
            <h3>Machine Context</h3><b>Landa S11-1P</b><span className="online">ONLINE</span>
            <div className="tiny-machine"><LandaMachineSvg /></div>
            <button>View Machine Overview</button>
          </div>
          <div className="context-card issue-mini"><span>Active Issue</span><b>BSS Blanket System</b><p>Blanket Pressure Deviation</p><div className="mini-stat"><small>State</small><strong>Printing</strong></div><div className="mini-stat"><small>Since</small><strong>22m 14s</strong></div><div className="mini-stat"><small>Confidence</small><strong>96% High</strong></div></div>
          <div className="tree-card"><h3>Subsystem Navigation</h3>{componentNodes.map((n) => <button key={n.code} className={selectedComponent.code === n.code ? 'active' : ''} onClick={() => setSelectedComponent(n)}><i className={n.status.toLowerCase()} />{n.name}</button>)}</div>
        </aside>

        <main className="drill-main">
          <div className="tabs-row">{['Overview', 'Signals', 'Components', 'Logs', 'Rules', 'Maintenance History'].map((t, i) => <button className={i === 0 ? 'active' : ''} key={t}>{t}</button>)}</div>
          <div className="cutaway-card">
            <div className="cutaway-title"><div><h2>BSS Blanket System — Cutaway View</h2><p>Click any component hotspot to analyze signals, health and evidence.</p></div><div className="status-legend"><span><i className="critical" />Critical</span><span><i className="warning" />Warning</span><span><i className="normal" />Normal</span></div></div>
            <div className="cutaway-stage">
              <BlanketCutawaySvg />
              {componentNodes.map((n) => <button key={n.code} className={cls('component-node', n.status.toLowerCase(), selectedComponent.code === n.code && 'selected')} style={{ left: `${n.x}%`, top: `${n.y}%` }} onClick={() => setSelectedComponent(n)}><span /> <b>{n.name}</b><small>{n.code} · {n.status}</small></button>)}
            </div>
          </div>
          <div className="drill-bottom-grid">
            <ComponentHealth selected={selectedComponent} />
            <WhyPanda />
          </div>
        </main>

        <aside className="drill-right">
          <section className="key-signal"><div className="panel-title">Key Signal — Blanket Cylinder Pressure <span>50 min</span></div><SignalMiniChart critical /></section>
          <section className="compact-timeline"><div className="panel-title">Machine State Timeline</div><StateTimeline /></section>
          <RecommendedActions />
        </aside>
      </div>

      <div className="drill-footer-grid">
        <EvidenceLog />
        <section className="table-card"><div className="panel-title">Recent Occurrences</div>{[['May 27, 13:47','22m 14s','-96 psi','P1'],['May 26, 09:12','8m 03s','-72 psi','P2'],['May 24, 14:33','6m 21s','-68 psi','P2']].map((r)=><div className="table-row" key={r.join('-')}><span>{r[0]}</span><span>{r[1]}</span><span>{r[2]}</span><b>{r[3]}</b></div>)}</section>
        <section className="table-card"><div className="panel-title">Related Rules</div>{relatedRules.map((r)=><div className="table-row" key={r[0]}><span>{r[0]}</span><span>{r[1]}</span><b>{r[2]}</b><em>{r[3]}</em></div>)}</section>
      </div>
    </div>
  );
}

function BlanketCutawaySvg() {
  return (
    <svg className="blanket-svg" viewBox="0 0 900 390">
      <defs><linearGradient id="module" x1="0" x2="1"><stop offset="0" stopColor="#151b22"/><stop offset="1" stopColor="#05080c"/></linearGradient><filter id="redGlow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <path d="M76 109 L236 42 L787 91 C832 95 857 122 858 164 L858 308 L159 318 C106 318 74 286 70 238 Z" fill="url(#module)" stroke="#2b3440" strokeWidth="3" />
      <path d="M118 134 L245 77 L756 116" stroke="#6b7280" strokeWidth="3" opacity=".5" />
      <path d="M138 237 L812 246" stroke="#223344" strokeWidth="4" />
      <rect x="146" y="173" width="378" height="78" rx="38" fill="#b7bdc6" stroke="#68707b" strokeWidth="5" />
      <circle cx="165" cy="212" r="42" fill="#2a2f38" stroke="#64748b" strokeWidth="8" />
      <circle cx="165" cy="212" r="34" fill="#ef4444" opacity=".6" filter="url(#redGlow)" />
      <rect x="120" y="250" width="138" height="46" rx="20" fill="#2a3340" stroke="#64748b" />
      <rect x="300" y="251" width="94" height="52" rx="16" fill="#2a3340" stroke="#64748b" />
      <path d="M480 172 C590 161 689 151 788 145" stroke="#0ea5e9" strokeWidth="7" fill="none" opacity=".7" />
      <path d="M490 210 H760 C792 210 810 230 808 259" stroke="#1f9d74" strokeWidth="6" fill="none" opacity=".65" />
      <path d="M534 250 C566 218 609 205 672 206" stroke="#8b5cf6" strokeWidth="5" fill="none" opacity=".45" />
      <rect x="635" y="148" width="94" height="58" rx="14" fill="#1b2430" stroke="#475569" />
      <rect x="714" y="236" width="84" height="58" rx="14" fill="#1b2430" stroke="#475569" />
      <circle cx="506" cy="236" r="14" fill="#f59e0b" filter="url(#redGlow)" />
      <circle cx="744" cy="182" r="12" fill="#38bdf8" />
      <circle cx="761" cy="267" r="12" fill="#38bdf8" />
    </svg>
  );
}

function ComponentHealth({ selected }) {
  return (
    <section className="health-card"><div className="panel-title">Component Health — Likely Root Cause</div>{componentNodes.map((n, i) => <div className={cls('health-row', selected.code === n.code && 'selected')} key={n.code}><b>{i + 1}</b><span>{n.name}<small>{n.code}</small></span><em>{n.score}/100</em><div className="prob"><i style={{ width: `${n.probability}%` }} /></div><strong>{n.probability}%</strong></div>)}</section>
  );
}

function WhyPanda() {
  const why = ['State context valid — deviation occurred during stable Printing state.', 'Sustained deviation — actual pressure outside band for 22m 14s.', 'Repeated occurrences — similar deviations detected 4 times in last 7 days.', 'Correlation with events — pressure drop aligns with logs and state changes.'];
  return <section className="why-card"><div className="panel-title">Why PANDA suspects this</div>{why.map((w) => <div className="why-row" key={w}><CheckCircle2 size={18}/><span>{w}</span></div>)}<div className="confidence-bar"><span>Overall Confidence</span><i><b style={{ width: '96%' }} /></i><strong>96%</strong></div></section>;
}

function OverviewApp({ openDrilldown }) {
  const [selected, setSelected] = useState(machineHotspots.find((h) => h.id === 'bss'));
  return (
    <>
      <Header />
      <main className="app-shell">
        <div className="kpi-grid">
          <KpiCard icon={DatabaseZap} label="Machines at Risk" value="3 / 18" sub="With active anomalies" />
          <KpiCard icon={AlertTriangle} label="P1 Alerts" value="2" sub="Requiring immediate attention" tone="red" />
          <KpiCard icon={Gauge} label="Detection Confidence" value="92%" sub="Average across all machines" spark />
          <KpiCard icon={FileText} label="Open Preventive Actions" value="7" sub="Across 4 machines" />
          <KpiCard icon={Clock3} label="Mean Time to Detect" value="18 min" sub="↓ 22% vs last 30 days" />
        </div>
        <div className="overview-grid">
          <div className="overview-main"><MachineOverview selected={selected} setSelected={setSelected} openDrilldown={openDrilldown} /></div>
          <IssuePanel selected={selected} openDrilldown={openDrilldown} />
        </div>
        <div className="bottom-grid"><StateTimeline /><EvidenceLog /><RecommendedActions /></div>
      </main>
      <footer className="status-bar"><span className="landa-footer">Landa</span><span><i />Data Connection</span><span><i />PANDA Engine</span><span>Last Data: 14:10:15</span><em>Machine: Landa S11-1P | Site: Customer A | Service User: John D.</em></footer>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState('overview');
  return screen === 'overview' ? <OverviewApp openDrilldown={() => setScreen('drill')} /> : <Drilldown close={() => setScreen('overview')} />;
}
