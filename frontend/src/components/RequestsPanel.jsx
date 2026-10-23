import { useState } from "react";
import { api } from "../lib/api.js";
import "./RequestsPanel.css";

function ConnectionRequestRow({ request, onDone }) {
  const [deviceName, setDeviceName] = useState(request.name);
  const [limitGB, setLimitGB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setError("");
    setLoading(true);
    try {
      const peer = await api.createPeer({
        name: deviceName.trim(),
        limitGB: limitGB === "" ? null : Number(limitGB),
        ownerId: request.user_id,
      });
      await api.updateConnectionRequest(request.id, "approved");
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function reject() {
    await api.updateConnectionRequest(request.id, "rejected");
    onDone();
  }

  return (
    <div className="request-row">
      <div className="request-info">
        <span className="request-name">{request.name}</span>
        {request.full_name && (
          <span className="request-comment">👤 {request.full_name}</span>
        )}
        {request.contact && (
          <span className="request-comment">📱 {request.contact}</span>
        )}
        {request.comment && <span className="request-comment">💬 {request.comment}</span>}
      </div>
      <div className="request-form">
        <input
          className="request-input"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="Имя устройства"
        />
        <input
          className="request-input request-input-limit"
          type="number"
          min="0"
          value={limitGB}
          onChange={(e) => setLimitGB(e.target.value)}
          placeholder="ГБ"
        />
        <button className="btn-primary" onClick={approve} disabled={loading}>
          {loading ? "…" : "Выдать доступ"}
        </button>
        <button className="btn-ghost" onClick={reject} disabled={loading}>
          Отклонить
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function SupportTicketRow({ ticket, onDone }) {
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  async function resolve() {
    setLoading(true);
    await api.resolveSupportTicket(ticket.id, response.trim());
    setLoading(false);
    onDone();
  }

  return (
    <div className="request-row">
      <div className="request-info">
        <span className="request-name">{ticket.name}</span>
        <span className="request-comment">{ticket.message}</span>
      </div>
      <div className="request-form request-form-wide">
        <input
          className="request-input request-input-wide"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Ваш ответ…"
        />
        <button className="btn-primary" onClick={resolve} disabled={loading || !response.trim()}>
          {loading ? "…" : "Ответить"}
        </button>
      </div>
    </div>
  );
}

export default function RequestsPanel({ requests, tickets, onChanged }) {
  if (requests.length === 0 && tickets.length === 0) {
    return <div className="empty-state">Новых заявок и обращений нет</div>;
  }

  return (
    <div className="requests-panel">
      {requests.length > 0 && (
        <div className="requests-section">
          <h2 className="requests-title">Заявки на подключение ({requests.length})</h2>
          {requests.map((r) => (
            <ConnectionRequestRow key={r.id} request={r} onDone={onChanged} />
          ))}
        </div>
      )}
      {tickets.length > 0 && (
        <div className="requests-section">
          <h2 className="requests-title">Обращения в поддержку ({tickets.length})</h2>
          {tickets.map((t) => (
            <SupportTicketRow key={t.id} ticket={t} onDone={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
