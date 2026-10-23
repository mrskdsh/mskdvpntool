import "./Tabs.css";

export default function Tabs({ tabs, active, onChange }) {
  return (
    <nav className="tabs" aria-label="Разделы">
      <div className="tabs-inner" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className="tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.badge > 0 ? (
              <span className="tab-badge">{t.badge}</span>
            ) : t.count != null ? (
              <span className="tab-count">{t.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
