import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api.js";
import { devicesLabel } from "../lib/format.js";
import "./CreatePeerModal.css";
import "./MigrateModal.css";

const MODES = [
  {
    id: "copy",
    title: "Копировать",
    text: "Старый доступ продолжит работать, пока клиент не перейдёт на новый",
  },
  {
    id: "move",
    title: "Перенести",
    text: "Старый доступ сразу удалится с прежнего сервера",
  },
];

export default function MigrateModal({ open, peers, servers, onMigrated, onClose }) {
  const [targetId, setTargetId] = useState("");
  const [mode, setMode] = useState("copy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setTargetId("");
      setMode("copy");
      setError("");
      setResult(null);
    }
  }, [open]);

  const total = peers.length;
  const hereCount = (serverId) => peers.filter((p) => p.serverId === serverId).length;

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const res = await api.migratePeers({
        peerIds: peers.map((p) => p.id),
        targetServerId: targetId,
        mode,
      });
      setResult(res);
      await onMigrated();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function close() {
    onClose(Boolean(result));
  }

  const targetName = servers.find((s) => s.id === targetId)?.name;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop migrate-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={loading ? undefined : close}
        >
          <motion.div
            className="modal-card migrate-card"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {result ? (
              <>
                <h2 className="modal-title">Готово</h2>
                <p className="modal-sub">
                  Создано доступов на «{targetName}»: {result.created.length}
                  {result.skipped > 0 && ` · пропущено: ${result.skipped} (уже на этом сервере)`}
                </p>

                {result.failed.length > 0 && (
                  <div className="migrate-failed">
                    <b>Не удалось ({result.failed.length}):</b>
                    {result.failed.map((f) => (
                      <div key={f.id}>
                        {f.name} — {f.error}
                      </div>
                    ))}
                  </div>
                )}
                {result.warning && <p className="error-text">{result.warning}</p>}

                {result.created.length > 0 && (
                  <p className="migrate-note">
                    У новых доступов другие ключи и адрес. Клиентам нужно заново подключиться: откройте «QR» у
                    нового доступа и отправьте конфиг.
                    {result.mode === "copy" && " Когда все перейдут, удалите старые доступы."}
                  </p>
                )}

                <div className="modal-actions">
                  <button className="btn-primary" onClick={close}>
                    Закрыть
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal-title">Перенести на другой сервер</h2>
                <p className="modal-sub">Выбрано доступов: {total}</p>

                <div className="migrate-group" role="radiogroup" aria-label="Сервер">
                  <span className="migrate-label">Куда</span>
                  {servers.map((s) => {
                    const here = hereCount(s.id);
                    const disabled = here === total;
                    return (
                      <label
                        key={s.id}
                        className={`migrate-option ${targetId === s.id ? "active" : ""} ${disabled ? "disabled" : ""}`}
                      >
                        <input
                          type="radio"
                          name="migrate-target"
                          value={s.id}
                          checked={targetId === s.id}
                          disabled={disabled}
                          onChange={() => setTargetId(s.id)}
                        />
                        <span className="migrate-option-main">
                          <b>{s.name}</b>
                          <span>
                            {s.endpoint} · {devicesLabel(s.peerCount)}
                          </span>
                          {here > 0 && (
                            <span className="migrate-option-hint">
                              {disabled ? "все выбранные уже здесь" : `${here} из выбранных уже здесь — будут пропущены`}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="migrate-group" role="radiogroup" aria-label="Режим">
                  <span className="migrate-label">Что сделать со старыми</span>
                  {MODES.map((m) => (
                    <label key={m.id} className={`migrate-option ${mode === m.id ? "active" : ""}`}>
                      <input
                        type="radio"
                        name="migrate-mode"
                        value={m.id}
                        checked={mode === m.id}
                        onChange={() => setMode(m.id)}
                      />
                      <span className="migrate-option-main">
                        <b>{m.title}</b>
                        <span>{m.text}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <p className="migrate-note">
                  Для новых доступов создаются новые ключи, счётчик трафика у них начнётся с нуля. Имя, владелец,
                  лимит и блокировка сохранятся.
                </p>

                {error && <p className="error-text">{error}</p>}

                <div className="modal-actions">
                  <button className="btn-ghost" onClick={close} disabled={loading}>
                    Отмена
                  </button>
                  <button className="btn-primary" onClick={submit} disabled={!targetId || loading}>
                    {loading ? "Переносим…" : mode === "move" ? "Перенести" : "Скопировать"}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
