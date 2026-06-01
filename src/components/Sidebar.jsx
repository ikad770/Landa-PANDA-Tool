import { NAV_ITEMS } from '../utils/constants.js';

export default function Sidebar({ activeView, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">P</div>
        <div>
          <strong>PANDA</strong>
          <span>Service Intelligence</span>
        </div>
      </div>
      <nav className="nav-list" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            className={activeView === item ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => onNavigate(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span>Foundation build</span>
        <strong>Rule-engine ready</strong>
      </div>
    </aside>
  );
}
