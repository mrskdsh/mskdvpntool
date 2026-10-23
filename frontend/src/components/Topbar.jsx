import { useEffect, useRef, useState } from "react";
import "./Topbar.css";

export default function Topbar({ title, items }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function pick(item) {
    setOpen(false);
    item.onClick();
  }

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="dot" />
        <span className="topbar-name">{title}</span>
      </div>

      <div className="topbar-actions">
        {items.map((item) => (
          <button key={item.label} className="logout-btn" onClick={item.onClick}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="topbar-menu" ref={menuRef}>
        <button
          className="topbar-menu-btn"
          aria-label="Меню"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        {open && (
          <div className="topbar-dropdown" role="menu">
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={`topbar-dropdown-item ${item.danger ? "danger" : ""}`}
                onClick={() => pick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
