import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./CreatePeerModal.css";

export default function AssignModal({ peer, currentOwnerId, profiles, onClose, onAssign, onUnassign }) {
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allProfiles = profiles || [];

  async function handleAssign() {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await onAssign(selected);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnassign() {
    setLoading(true);
    setError("");
    try {
      await onUnassign();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {peer && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Назначить «{peer.name}»</h2>
            <p className="modal-sub">
              Выберите логин, которому будет виден этот доступ в личном кабинете
            </p>

            <div className="field">
              <label>Логин</label>
              <select
                className="assign-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">— выбрать —</option>
                {allProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name || p.id}
                    {p.role === "admin" ? " (админ)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              {currentOwnerId && (
                <button className="btn-ghost" onClick={handleUnassign} disabled={loading}>
                  Открепить
                </button>
              )}
              <button className="btn-ghost" onClick={onClose}>
                Отмена
              </button>
              <button className="btn-primary" onClick={handleAssign} disabled={!selected || loading}>
                {loading ? "…" : "Назначить"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
