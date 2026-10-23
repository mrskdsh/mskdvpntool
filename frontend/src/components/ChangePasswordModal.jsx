import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api.js";
import "./CreatePeerModal.css";

export default function ChangePasswordModal({ open, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.changePassword(current, next);
      setSuccess(true);
      setCurrent("");
      setNext("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setSuccess(false);
    setError("");
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="modal-card"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Сменить пароль</h2>

            {success ? (
              <>
                <p className="modal-sub">Пароль успешно изменён.</p>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={handleClose}>
                    Готово
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label>Текущий пароль</label>
                  <input
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                    required
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Новый пароль</label>
                  <input
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </div>
                {error && <p className="error-text">{error}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={handleClose}>
                    Отмена
                  </button>
                  <button className="btn-primary" disabled={loading}>
                    {loading ? "…" : "Сменить"}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
