import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api.js";
import UsageGauge from "../components/UsageGauge.jsx";
import QrModal from "../components/QrModal.jsx";
import SupportModal from "../components/SupportModal.jsx";
import ConnectGuide from "../components/ConnectGuide.jsx";
import ChangePasswordModal from "../components/ChangePasswordModal.jsx";
import ConnectionRequestModal from "../components/ConnectionRequestModal.jsx";
import Topbar from "../components/Topbar.jsx";
import "./Dashboard.css";
import "./ClientDashboard.css";

const statusLabels = {
  pending: "на рассмотрении",
  approved: "одобрено",
  rejected: "отклонено",
  open: "на рассмотрении",
  resolved: "отвечено",
};

export default function ClientDashboard({ user, onLogout }) {
  const [peers, setPeers] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestExtraDevice, setRequestExtraDevice] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [myTickets, setMyTickets] = useState([]);

  async function loadPeers() {
    try {
      const data = await api.listPeers();
      setPeers(data);
      if (!activeId && data.length > 0) setActiveId(data[0].id);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadHistory() {
    const [reqs, tix] = await Promise.all([
      api.listConnectionRequests(),
      api.listSupportTickets(),
    ]);
    setMyRequests(reqs);
    setMyTickets(tix);
  }

  useEffect(() => {
    loadPeers();
    loadHistory();
    const interval = setInterval(() => {
      loadPeers();
      loadHistory();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  function openRequestModal(extraDevice) {
    setRequestExtraDevice(extraDevice);
    setShowRequestModal(true);
  }

  async function submitConnectionRequest({ fullName, contact, comment }) {
    await api.createConnectionRequest({ fullName, contact, comment });
    setRequestSent(true);
    setTimeout(() => setRequestSent(false), 5000);
    await loadHistory();
  }

  async function submitSupport(message) {
    await api.createSupportTicket(message);
    await loadHistory();
  }

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  const activePeer = peers.find((p) => p.id === activeId);
  const hasHistory = myRequests.length > 0 || myTickets.length > 0;

  return (
    <div className="shell">
      <Topbar
        title="Mr. Skdsh VPN"
        items={[
          { label: "Как подключиться", onClick: () => setShowGuide(true) },
          { label: "Пароль", onClick: () => setShowPasswordModal(true) },
          { label: "Поддержка", onClick: () => setShowSupport(true) },
          { label: "Выйти", onClick: handleLogout, danger: true },
        ]}
      />

      <div className="content client-content">
        {peers.length === 0 && (
          <motion.div
            className="card no-access"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 className="section-title">Доступа пока нет</h2>
            <p className="section-sub">
              Запросите подключение — админ увидит заявку и выдаст доступ
            </p>
            <button
              className="btn-primary"
              onClick={() => openRequestModal(false)}
              disabled={requestSent}
            >
              {requestSent ? "Заявка отправлена ✓" : "Запросить подключение"}
            </button>
          </motion.div>
        )}

        {error && <p className="error-text">{error}</p>}

        {peers.length > 1 && (
          <div className="device-tabs">
            {peers.map((p) => (
              <button
                key={p.id}
                className={`device-tab ${p.id === activeId ? "active" : ""}`}
                onClick={() => setActiveId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {activePeer && (
          <motion.div
            className="card client-card"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={activeId}
          >
            <div className="client-gauge-wrap">
              <UsageGauge usedGB={activePeer.usedGB} limitGB={activePeer.limitGB} size={160} />
            </div>

            <div className="client-status-line">
              <span className={`peer-status ${activePeer.online ? "online" : ""}`}>
                {activePeer.blocked ? "заблокирован" : activePeer.online ? "в сети" : "офлайн"}
              </span>
              {activePeer.address && activePeer.address !== "-" && (
                <span className="peer-address">{activePeer.address}</span>
              )}
            </div>

            {activePeer.blocked && (
              <p className="blocked-note">
                Доступ приостановлен — превышен лимит трафика. Напишите админу.
              </p>
            )}

            <button className="btn-primary client-qr-btn" onClick={() => setShowQr(true)}>
              Показать QR / конфиг
            </button>
          </motion.div>
        )}

        {peers.length > 0 && (
          <button
            className="btn-ghost add-device-btn"
            onClick={() => openRequestModal(true)}
            disabled={requestSent}
          >
            {requestSent ? "Заявка отправлена ✓" : "+ Запросить ещё устройство"}
          </button>
        )}

        {hasHistory && (
          <div className="history-section">
            <p className="label">Мои обращения</p>
            {myRequests.map((r) => (
              <div key={r.id} className="history-item">
                <span className="history-item-title">
                  Заявка на подключение{r.comment ? ` (${r.comment})` : ""}
                </span>
                <span className={`history-status history-status--${r.status}`}>
                  {statusLabels[r.status]}
                </span>
              </div>
            ))}
            {myTickets.map((t) => (
              <div key={t.id} className="history-item">
                <div className="history-item-body">
                  <span className="history-item-title">{t.message}</span>
                  {t.response && <span className="history-response">Ответ: {t.response}</span>}
                </div>
                <span className={`history-status history-status--${t.status}`}>
                  {statusLabels[t.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <QrModal peer={showQr ? activePeer : null} onClose={() => setShowQr(false)} />
      <SupportModal open={showSupport} onClose={() => setShowSupport(false)} onSubmit={submitSupport} />
      <ConnectGuide open={showGuide} onClose={() => setShowGuide(false)} />
      <ChangePasswordModal open={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
      <ConnectionRequestModal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        onSubmit={submitConnectionRequest}
        extraDevice={requestExtraDevice}
      />
    </div>
  );
}
