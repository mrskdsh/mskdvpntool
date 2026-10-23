import { useState } from "react";
import { api } from "../lib/api.js";
import "./RequestsPanel.css";
import "./AccountsPanel.css";

export default function AccountsPanel({ users, onReload }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [resettingId, setResettingId] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetResult, setResetResult] = useState(null);

  const clients = (users || []).filter((p) => p.role !== "admin");

  async function handleDelete(profile) {
    if (
      !confirm(
        `Удалить аккаунт «${profile.display_name || profile.username}»? Логин пропадёт, а его устройства останутся в списке, просто без привязки.`
      )
    )
      return;

    setError("");
    setBusyId(profile.id);
    try {
      await api.deleteUser(profile.id);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function startReset(profile) {
    setResettingId(profile.id);
    setNewPassword("");
    setResetResult(null);
    setError("");
  }

  async function confirmReset(profile) {
    if (newPassword.length < 6) {
      setError("Пароль должен быть не короче 6 символов");
      return;
    }
    setError("");
    setBusyId(profile.id);
    try {
      await api.resetPassword(profile.id, newPassword);
      setResetResult({ username: profile.username, password: newPassword });
      setResettingId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="accounts-panel">
      {clients.length === 0 ? (
        <div className="empty-state">Клиентских аккаунтов пока нет</div>
      ) : (
        <div className="accounts-list">
          {resetResult && (
            <div className="reset-result">
              Новый пароль для <b>{resetResult.username}</b>: <code>{resetResult.password}</code>
              <button className="btn-ghost" onClick={() => setResetResult(null)}>
                ✕
              </button>
            </div>
          )}

          {clients.map((p) => (
            <div key={p.id} className="account-row">
              <span className="account-name" title={p.display_name || p.username}>
                {p.display_name || p.username}
              </span>

              {resettingId === p.id ? (
                <div className="account-reset-form">
                  <input
                    type="text"
                    placeholder="новый пароль"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoFocus
                  />
                  <button
                    className="btn-primary"
                    onClick={() => confirmReset(p)}
                    disabled={busyId === p.id}
                  >
                    ✓
                  </button>
                  <button className="btn-ghost" onClick={() => setResettingId(null)}>
                    ✕
                  </button>
                </div>
              ) : (
                <div className="account-actions">
                  <button className="btn-ghost" onClick={() => startReset(p)}>
                    Сбросить пароль
                  </button>
                  <button
                    className="btn-ghost peer-delete"
                    onClick={() => handleDelete(p)}
                    disabled={busyId === p.id}
                  >
                    {busyId === p.id ? "…" : "Удалить"}
                  </button>
                </div>
              )}
            </div>
          ))}
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
