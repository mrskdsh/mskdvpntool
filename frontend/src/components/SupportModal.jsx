import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./CreatePeerModal.css";

export default function SupportModal({ open, onClose, onSubmit }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onSubmit(message);
      setSent(true);
      setMessage("");
    } catch (err) {
      setError(err.message || "Не удалось отправить");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setSent(false);
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
            {sent ? (
              <>
                <h2 className="modal-title">Отправлено ✓</h2>
                <p className="modal-sub">
                  Админ получит уведомление на почту и разберётся в проблеме
                </p>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={handleClose}>
                    Готово
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal-title">Что-то сломалось?</h2>
                <p className="modal-sub">Опишите проблему — админ получит письмо</p>

                <form onSubmit={handleSubmit}>
                  <div className="field">
                    <label>Описание проблемы</label>
                    <textarea
                      className="support-textarea"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Например: не подключается с телефона, пишет ошибку..."
                      rows={4}
                      required
                      autoFocus
                    />
                  </div>
                  {error && <p className="error-text">{error}</p>}
                  <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={handleClose}>
                      Отмена
                    </button>
                    <button className="btn-primary" disabled={loading}>
                      {loading ? "Отправляем…" : "Отправить"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
