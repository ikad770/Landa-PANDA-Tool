export default function AlertsPanel({ alerts }) {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Alerts</p>
          <h2>Active mock alerts</h2>
        </div>
      </div>
      <div className="alert-list">
        {alerts.map((alert) => (
          <article className={`alert-card ${alert.severity}`} key={alert.id}>
            <div>
              <strong>{alert.system} · {alert.component}</strong>
              <span>{alert.signalName}</span>
            </div>
            <p>{alert.evidence}</p>
            <footer>
              <span>{alert.status}</span>
              <span>{Math.round(alert.confidence * 100)}% confidence</span>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
