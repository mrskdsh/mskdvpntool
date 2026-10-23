import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./CreatePeerModal.css";

export default function CreatePeerModal({ open, onClose, onCreate, servers }) {
  const [name, setName] = useState("");
  const [limitGB, setLimitGB] = useState("");
  const [serverId, setServerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const needsServerChoice = (servers?.length || 0) > 1;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onCreate({
        name,
        limitGB: limitGB === "" ? null : Number(limitGB),
        serverId: serverId || undefined,
      });
      setName("");
      setLimitGB("");
      setServerId("");
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
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Новый доступ</h2>
            <p className="modal-sub">
              Ключи сгенерируются на сервере автоматически
            </p>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Имя</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например, Аня"
                  required
                  autoFocus
                />
              </div>

              {needsServerChoice && (
                <div className="field">
                  <label>Сервер</label>
                  <select
                    className="assign-select"
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                    required
                  >
                    <option value="">— выбрать —</option>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.peerCount} устройств)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <label>Лимит трафика, ГБ (необязательно)</label>
                <input
                  type="number"
                  min="0"
                  value={limitGB}
                  onChange={(e) => setLimitGB(e.target.value)}
                  placeholder="без лимита"
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={onClose}>
                  Отмена
                </button>
                <button className="btn-primary" disabled={loading}>
                  {loading ? "Создаём…" : "Создать"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
