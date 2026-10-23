import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import PeerRow from "../components/PeerRow.jsx";
import CreatePeerModal from "../components/CreatePeerModal.jsx";
import QrModal from "../components/QrModal.jsx";
import SupportModal from "../components/SupportModal.jsx";
import ConnectGuide from "../components/ConnectGuide.jsx";
import ChangePasswordModal from "../components/ChangePasswordModal.jsx";
import RequestsPanel from "../components/RequestsPanel.jsx";
import AssignModal from "../components/AssignModal.jsx";
import AccountsPanel from "../components/AccountsPanel.jsx";
import ServersPanel from "../components/ServersPanel.jsx";
import Topbar from "../components/Topbar.jsx";
import Tabs from "../components/Tabs.jsx";
import MigrateModal from "../components/MigrateModal.jsx";
import "./Dashboard.css";

const TAB_IDS = ["peers", "servers", "accounts", "requests"];

function tabFromHash() {
  const id = window.location.hash.slice(1);
  return TAB_IDS.includes(id) ? id : "peers";
}

export default function AdminDashboard({ user, onLogout }) {
  const [tab, setTab] = useState(tabFromHash);
  const [requests, setRequests] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [peers, setPeers] = useState(null);
  const [users, setUsers] = useState([]);
  const [servers, setServers] = useState([]);
  const [serverFilter, setServerFilter] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [qrPeer, setQrPeer] = useState(null);
  const [assignPeer, setAssignPeer] = useState(null);
  const [showSupport, setShowSupport] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [migrateOpen, setMigrateOpen] = useState(false);

  async function load() {
    try {
      const data = await api.listPeers(serverFilter || undefined);
      setPeers(data);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadUsers() {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      console.error(e);
    }
  }

  async function loadServers() {
    try {
      setServers(await api.listServers());
    } catch (e) {
      console.error(e);
    }
  }

  async function loadRequests() {
    try {
      const [reqs, tix] = await Promise.all([
        api.listConnectionRequests(),
        api.listSupportTickets(),
      ]);
      setRequests(reqs.filter((r) => r.status === "pending"));
      setTickets(tix.filter((t) => t.status === "open"));
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRequestsChanged() {
    await Promise.all([loadRequests(), load(), loadUsers()]);
  }

  function changeTab(id) {
    setTab(id);
    const url = id === "peers" ? window.location.pathname + window.location.search : `#${id}`;
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    load();
    loadUsers();
    loadServers();
    loadRequests();
    const interval = setInterval(() => {
      load();
      loadUsers();
      loadServers();
      loadRequests();
    }, 30000);
    return () => clearInterval(interval);
  }, [serverFilter]);

  async function runAction(id, fn) {
    setActionError("");
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(data) {
    await api.createPeer(data);
    await load();
    await loadServers();
  }

  function handleUpdateLimit(id, limitGB) {
    return runAction(id, () => api.updatePeer(id, { limitGB }));
  }

  function handleRename(id, name) {
    return runAction(id, () => api.updatePeer(id, { name }));
  }

  function handleToggleBlock(id, blocked) {
    return runAction(id, () => api.updatePeer(id, { blocked }));
  }

  function handleDelete(id) {
    if (!confirm("Удалить доступ безвозвратно?")) return;
    return runAction(id, () => api.deletePeer(id));
  }

  async function handleAssign(ownerId) {
    await api.updatePeer(assignPeer.id, { ownerId });
    await load();
  }

  async function handleUnassign() {
    await api.updatePeer(assignPeer.id, { ownerId: null });
    await load();
  }

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  async function submitSupport(message) {
    await api.createSupportTicket(message);
  }

  const selectedPeers = (peers || []).filter((p) => selectedIds.has(p.id));
  const allSelected = peers?.length > 0 && selectedPeers.length === peers.length;

  function toggleSelecting() {
    setSelecting((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(peers.map((p) => p.id)));
  }

  async function handleMigrated() {
    await Promise.all([load(), loadServers()]);
  }

  function closeMigrate(done) {
    setMigrateOpen(false);
    if (done) {
      setSelecting(false);
      setSelectedIds(new Set());
    }
  }

  const totalUsed = peers?.reduce((s, p) => s + p.usedGB, 0) ?? 0;
  const clientCount = users.filter((u) => u.role !== "admin").length;
  const tabs = [
    { id: "peers", label: "Доступы", count: peers?.length ?? null },
    { id: "servers", label: "Серверы", count: servers.length },
    { id: "accounts", label: "Аккаунты", count: clientCount },
    { id: "requests", label: "Заявки", badge: requests.length + tickets.length },
  ];

  return (
    <div className="shell">
      <Topbar
        title="Mr. Skdsh VPN · админ"
        items={[
          { label: "Как подключиться", onClick: () => setShowGuide(true) },
          { label: "Пароль", onClick: () => setShowPasswordModal(true) },
          { label: "Поддержка", onClick: () => setShowSupport(true) },
          { label: "Выйти", onClick: handleLogout, danger: true },
        ]}
      />

      <Tabs tabs={tabs} active={tab} onChange={changeTab} />

      <div className="content">
        {tab === "peers" && (
          <>
            <h1 className="section-title">Доступы</h1>
            <p className="section-sub">
              {peers ? `${peers.length} · за месяц использовано ${totalUsed.toFixed(1)} ГБ` : "Загрузка…"}
            </p>

            <div className="dash-toolbar">
              <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                + Новый доступ
              </button>
              {servers.length > 1 && (
                <select
                  className="server-filter-select"
                  value={serverFilter}
                  onChange={(e) => {
                    setServerFilter(e.target.value);
                    setSelectedIds(new Set());
                  }}
                >
                  <option value="">Все серверы</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              {servers.length > 1 && peers?.length > 0 && (
                <button className="btn-ghost" onClick={toggleSelecting}>
                  {selecting ? "Готово" : "Выбрать"}
                </button>
              )}
            </div>

            {error && <p className="error-text">{error}</p>}
            {actionError && <p className="error-text">{actionError}</p>}

            <div className="peer-list">
              {peers?.map((peer) => (
                <PeerRow
                  key={peer.id}
                  peer={peer}
                  busy={busyId === peer.id}
                  assignedTo={users.find((u) => u.id === peer.ownerId)?.display_name}
                  serverName={servers.length > 1 ? servers.find((s) => s.id === peer.serverId)?.name : null}
                  onUpdateLimit={handleUpdateLimit}
                  onRename={handleRename}
                  onToggleBlock={handleToggleBlock}
                  onDelete={handleDelete}
                  onShowQr={setQrPeer}
                  onAssign={setAssignPeer}
                  selectable={selecting}
                  selected={selectedIds.has(peer.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
              {peers?.length === 0 && (
                <div className="empty-state">Пока никого нет — создайте первый доступ</div>
              )}
            </div>

            {selecting && (
              <div className="select-bar">
                <span className="select-bar-count">Выбрано: {selectedPeers.length}</span>
                <button className="btn-ghost" onClick={toggleSelectAll}>
                  {allSelected ? "Снять все" : "Все"}
                </button>
                <button
                  className="btn-primary"
                  disabled={selectedPeers.length === 0}
                  onClick={() => setMigrateOpen(true)}
                >
                  Перенести…
                </button>
              </div>
            )}
          </>
        )}

        {tab === "servers" && (
          <>
            <h1 className="section-title">Серверы</h1>
            <p className="section-sub">Серверы, на которых выдаются доступы</p>
            <ServersPanel servers={servers} onReload={loadServers} />
          </>
        )}

        {tab === "accounts" && (
          <>
            <h1 className="section-title">Аккаунты</h1>
            <p className="section-sub">Логины клиентов для личного кабинета</p>
            <AccountsPanel users={users} onReload={loadUsers} />
          </>
        )}

        {tab === "requests" && (
          <>
            <h1 className="section-title">Заявки</h1>
            <p className="section-sub">Запросы на подключение и обращения в поддержку</p>
            <RequestsPanel requests={requests} tickets={tickets} onChanged={handleRequestsChanged} />
          </>
        )}
      </div>

      <CreatePeerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        servers={servers}
      />
      <MigrateModal
        open={migrateOpen}
        peers={selectedPeers}
        servers={servers}
        onMigrated={handleMigrated}
        onClose={closeMigrate}
      />
      <QrModal peer={qrPeer} onClose={() => setQrPeer(null)} />
      <AssignModal
        peer={assignPeer}
        currentOwnerId={assignPeer?.ownerId}
        profiles={users}
        onClose={() => setAssignPeer(null)}
        onAssign={handleAssign}
        onUnassign={handleUnassign}
      />
      <SupportModal open={showSupport} onClose={() => setShowSupport(false)} onSubmit={submitSupport} />
      <ConnectGuide open={showGuide} onClose={() => setShowGuide(false)} />
      <ChangePasswordModal open={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </div>
  );
}
