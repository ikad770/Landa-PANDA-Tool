export default function Topbar({ sessionName, hasData }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Landa PANDA Tool</p>
        <h1>Press Analytics and Diagnostics Assistant</h1>
      </div>
      <div className="topbar-meta">
        <div>
          <span>Analysis session</span>
          <strong>{sessionName}</strong>
        </div>
        <div className={hasData ? 'status-pill live' : 'status-pill'}>
          {hasData ? 'Upload inventory loaded' : 'No upload data'}
        </div>
      </div>
    </header>
  );
}
