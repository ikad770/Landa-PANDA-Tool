import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

export default function Layout({ activeView, onNavigate, sessionName, hasData, children }) {
  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={onNavigate} />
      <main className="main-shell">
        <Topbar sessionName={sessionName} hasData={hasData} />
        <div className="content-shell">{children}</div>
      </main>
    </div>
  );
}
