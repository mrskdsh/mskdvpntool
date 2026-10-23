import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./CreatePeerModal.css";

export default function ConnectionRequestModal({ open, onClose, onSubmit, extraDevice }) {
  const [fullName, setFullName] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onSubmit({
        fullName,
        contact,
        comment: extraDevice ? "Запрос ещё одного устройства" : undefined,
      });
      setFullName("");
      setContact("");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
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
            <h2 className="modal-title">
              {extraDevice ? "Запрос ещё одного устройства" : "Запрос подключения"}
            </h2>
            <p className="modal-sub">
              Чтобы админ мог связаться с вами и выдать доступ, укажите пару данных
            </p>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Имя и фамилия</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Иван Иванов"
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Контакт для связи</label>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="телефон, Telegram или email"
                  required
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={onClose}>
                  Отмена
                </button>
                <button className="btn-primary" disabled={loading}>
                  {loading ? "Отправляем…" : "Отправить заявку"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
