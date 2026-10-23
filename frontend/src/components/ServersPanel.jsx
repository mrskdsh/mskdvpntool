import { useState } from "react";
import { api } from "../lib/api.js";
import { devicesLabel } from "../lib/format.js";
import AddServerModal from "./AddServerModal.jsx";
import "./RequestsPanel.css";
import "./AccountsPanel.css";

export default function ServersPanel({ servers, onReload }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  async function handleCreate(data) {
    await api.createServer(data);
    await onReload();
  }

  async function handleSave(id, data) {
    await api.updateServer(id, data);
    await onReload();
  }

  function openEdit(server) {
    setEditingServer(server);
    setShowAdd(true);
  }

  function closeModal() {
    setShowAdd(false);
    setEditingServer(null);
  }

  async function handleDelete(server) {
    if (server.peerCount > 0) {
      alert(`На сервере ещё ${server.peerCount} доступ(ов) — сначала перенесите или удалите их.`);
      return;
    }
    if (!confirm(`Удалить сервер «${server.name}»?`)) return;

    setError("");
    setBusyId(server.id);
    try {
      await api.deleteServer(server.id);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!servers) return null;

  return (
    <div className="accounts-panel">
      <div className="accounts-list">
        {servers.map((s) => (
          <div key={s.id} className="account-row">
            <span className="account-name">
              {s.name}
              {["vless-reality", "hysteria2", "shadowsocks"].includes(s.protocol) ? (
                <span className="ver-badge">{s.protocol === "hysteria2" ? "HYSTERIA2" : s.protocol === "shadowsocks" ? "SHADOWSOCKS" : "VLESS REALITY"}</span>
              ) : (
                <span className={`ver-badge ${s.awg_version === "3.1" ? "ver-badge-31" : ""}`}>
                  AWG {s.awg_version === "3.1" ? "3.1" : "2.0"}
                </span>
              )}
            </span>
            <span className="account-devices">
              {s.endpoint} · {devicesLabel(s.peerCount)}
            </span>
            <div className="account-actions">
              <button className="btn-ghost" onClick={() => openEdit(s)}>
                Изменить
              </button>
              <button
                className="btn-ghost peer-delete"
                onClick={() => handleDelete(s)}
                disabled={busyId === s.id}
              >
                {busyId === s.id ? "…" : "Удалить"}
              </button>
            </div>
          </div>
        ))}
        <button className="btn-ghost" onClick={() => setShowAdd(true)}>
          + Добавить сервер
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>

      <AddServerModal
        open={showAdd}
        onClose={closeModal}
        onCreate={handleCreate}
        onSave={handleSave}
        onProvisioned={onReload}
        editingServer={editingServer}
      />
    </div>
  );
}
