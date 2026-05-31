export default function KpiCard({ label, value, detail }) {
  return (
    <section className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </section>
  );
}
