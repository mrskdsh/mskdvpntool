import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ProvisionServerForm from "./ProvisionServerForm.jsx";
import VersionChoice from "./VersionChoice.jsx";
import "./CreatePeerModal.css";
import "../pages/Login.css";

const FIELDS = [
  { key: "name", label: "Название", placeholder: "Второй сервер" },
  { key: "endpoint", label: "Адрес:порт (для клиентов)", placeholder: "1.2.3.4:39001" },
  { key: "container", label: "Имя Docker-контейнера", placeholder: "skdsh-awg" },
  { key: "interface", label: "Имя сетевого интерфейса", placeholder: "awg0 — для первого сервера, иначе см. вывод add-server.sh" },
  { key: "configPath", label: "Путь к конфигу в контейнере", placeholder: "/etc/amnezia/amneziawg/awg0.conf" },
  { key: "publicKey", label: "Публичный ключ сервера" },
  { key: "presharedKey", label: "Preshared key" },
  { key: "subnetPrefix", label: "Префикс подсети", placeholder: "10.9.1." },
];

const SSH_FIELDS = [
  { key: "sshHost", label: "IP удалённого сервера", placeholder: "5.6.7.8" },
  { key: "sshUser", label: "SSH-пользователь", placeholder: "root" },
  { key: "sshKeyPath", label: "Путь к приватному SSH-ключу на этой машине", placeholder: "/root/.ssh/id_rsa" },
];

const SHORT_AWG_FIELDS = ["jc", "jmin", "jmax", "s1", "s2", "s3", "s4"];
const LONG_AWG_FIELDS = ["h1", "h2", "h3", "h4"];

function serverToForm(s) {
  if (!s) return {};
  return {
    name: s.name,
    endpoint: s.endpoint,
    container: s.container,
    interface: s.interface,
    configPath: s.config_path,
    publicKey: s.public_key,
    presharedKey: s.preshared_key,
    subnetPrefix: s.subnet_prefix,
    sshHost: s.ssh_host || "",
    sshUser: s.ssh_user || "",
    sshKeyPath: s.ssh_key_path || "",
    jc: s.jc, jmin: s.jmin, jmax: s.jmax,
    s1: s.s1, s2: s.s2, s3: s.s3, s4: s.s4,
    h1: s.h1, h2: s.h2, h3: s.h3, h4: s.h4,
    awgVersion: s.awg_version || "2",
    headerProtectionKey: s.extraParams?.headerProtectionKey || "",
    contentPaddingAddition: s.extraParams?.contentPaddingAddition || "0-64",
    randomTrailers: s.extraParams?.randomTrailers || "on",
    disableCookies: s.extraParams?.disableCookies || "off",
  };
}

const NEW_SERVER_DEFAULTS = {
  awgVersion: "2",
  contentPaddingAddition: "0-64",
  randomTrailers: "on",
  disableCookies: "off",
};

function buildPayload(form, isRemote) {
  const { awgVersion, headerProtectionKey, contentPaddingAddition, randomTrailers, disableCookies, ...rest } = form;
  const payload = { ...rest, awgVersion: awgVersion || "2" };
  if (!isRemote) payload.sshHost = undefined;
  if (payload.awgVersion === "3.1") {
    payload.extraParams = { headerProtectionKey, contentPaddingAddition, randomTrailers, disableCookies };
  }
  return payload;
}

export default function AddServerModal({ open, onClose, onCreate, onSave, onProvisioned, editingServer }) {
  const [form, setForm] = useState({});
  const [isRemote, setIsRemote] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState("create"); // create — развернуть новый, connect — подключить готовый
  const [busy, setBusy] = useState(false);
  const [provPhase, setProvPhase] = useState("form");

  const isEditing = Boolean(editingServer);
  const isV31 = form.awgVersion === "3.1";
  const isXrayEdit = isEditing && ["vless-reality", "hysteria2", "shadowsocks"].includes(editingServer.protocol);
  // Пока идёт развёртывание (и после него) подзаголовок и переключатель вкладок только мешают
  const showHeader = isEditing || kind !== "create" || provPhase === "form";

  useEffect(() => {
    if (open) {
      const initial = editingServer ? serverToForm(editingServer) : NEW_SERVER_DEFAULTS;
      setForm(initial);
      setIsRemote(Boolean(editingServer?.ssh_host));
      setKind("create");
      setBusy(false);
      setProvPhase("form");
    }
  }, [open, editingServer]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // У Xray-сервера можно менять только название и адрес: остальное задано на самом сервере
      const payload = isXrayEdit ? { name: form.name, endpoint: form.endpoint } : buildPayload(form, isRemote);
      if (isEditing) {
        await onSave(editingServer.id, payload);
      } else {
        await onCreate(payload);
      }
      setForm({});
      setIsRemote(false);
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
          onClick={busy ? undefined : onClose}
        >
          <motion.div
            className="modal-card"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "85vh", overflowY: "auto" }}
          >
            <h2 className="modal-title">{isEditing ? "Изменить сервер" : "Новый сервер"}</h2>
            {showHeader && (
            <p className="modal-sub">
              {isEditing
                ? "Меняйте только то, что реально изменилось на сервере"
                : kind === "create"
                  ? "Выберите протокол: панель сама развернёт сервер и добавит его, ключи и параметры вводить не нужно"
                  : 'Для сервера, который уже работает. Значения берутся из вывода install.sh / add-server.sh (раздел "Готово")'}
            </p>
            )}

            {showHeader && !isEditing && (
              <div className="login-mode-tabs">
                <button
                  type="button"
                  className={`login-mode-tab ${kind === "create" ? "active" : ""}`}
                  onClick={() => setKind("create")}
                  disabled={busy}
                >
                  Создать новый
                </button>
                <button
                  type="button"
                  className={`login-mode-tab ${kind === "connect" ? "active" : ""}`}
                  onClick={() => setKind("connect")}
                  disabled={busy}
                >
                  Подключить готовый
                </button>
              </div>
            )}

            {!isEditing && kind === "create" ? (
              <ProvisionServerForm
                onClose={onClose}
                onProvisioned={onProvisioned}
                onBusyChange={setBusy}
                onPhaseChange={setProvPhase}
              />
            ) : isXrayEdit ? (
              <form onSubmit={handleSubmit}>
                <p className="version-fixed" style={{ marginBottom: 16 }}>
                  {editingServer.protocol === "hysteria2" ? "Hysteria2" : editingServer.protocol === "shadowsocks" ? "Shadowsocks-2022" : "VLESS + REALITY"}
                  <span>
                    {" "}
                    — порт, сертификат и ключи у существующего сервера менять нельзя: у клиентов перестанут работать ссылки
                  </span>
                </p>
                <div className="field">
                  <label>Название</label>
                  <input value={form.name || ""} onChange={(e) => set("name", e.target.value)} maxLength={60} required />
                </div>
                <div className="field">
                  <label>Адрес для клиентов (IP или домен и порт)</label>
                  <input
                    value={form.endpoint || ""}
                    onChange={(e) => set("endpoint", e.target.value.trim())}
                    placeholder="1.2.3.4:443"
                    required
                  />
                </div>
                <p className="prov-hint">
                  Если поменяли IP или подключили домен, укажите новый адрес. Порт должен остаться тем, что настроен на
                  сервере. Уже выданные ссылки нужно будет получить заново.
                </p>
                {error && <p className="error-text">{error}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={onClose}>
                    Отмена
                  </button>
                  <button className="btn-primary" disabled={loading}>
                    {loading ? "…" : "Сохранить"}
                  </button>
                </div>
              </form>
            ) : (
              <>
            <div className="field">
              <label>Версия AmneziaWG</label>
              {isEditing ? (
                <p className="version-fixed">
                  AmneziaWG {isV31 ? "3.1" : "2.0"}
                  <span> — версию существующего сервера менять нельзя: у клиентов перестанут работать ключи</span>
                </p>
              ) : (
                <VersionChoice value={form.awgVersion} onChange={(v) => set("awgVersion", v)} />
              )}
            </div>

            <div className="login-mode-tabs">
              <button
                type="button"
                className={`login-mode-tab ${!isRemote ? "active" : ""}`}
                onClick={() => setIsRemote(false)}
              >
                На этой машине
              </button>
              <button
                type="button"
                className={`login-mode-tab ${isRemote ? "active" : ""}`}
                onClick={() => setIsRemote(true)}
              >
                Удалённый (по SSH)
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              {FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input
                    value={form[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    required={f.key !== "interface"}
                  />
                </div>
              ))}

              {isRemote && (
                <>
                  <p className="modal-sub" style={{ marginTop: "4px" }}>
                    Панель зайдёт на этот сервер по SSH, чтобы выполнить docker exec
                  </p>
                  {SSH_FIELDS.map((f) => (
                    <div className="field" key={f.key}>
                      <label>{f.label}</label>
                      <input
                        value={form[f.key] || ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        required
                      />
                    </div>
                  ))}
                </>
              )}

              <div className="field">
                <label>Jc / Jmin / Jmax / S1-S4 (короткие числа)</label>
                <div className="awg-short-grid">
                  {SHORT_AWG_FIELDS.map((k) => (
                    <input
                      key={k}
                      value={form[k] || ""}
                      onChange={(e) => set(k, e.target.value)}
                      placeholder={k.toUpperCase()}
                      required
                    />
                  ))}
                </div>
              </div>

              <div className="field">
                <label>H1-H4 (длинные диапазоны)</label>
                <div className="awg-long-grid">
                  {LONG_AWG_FIELDS.map((k) => (
                    <input
                      key={k}
                      value={form[k] || ""}
                      onChange={(e) => set(k, e.target.value)}
                      placeholder={`${k.toUpperCase()} — например 728858882-738013502`}
                      required
                    />
                  ))}
                </div>
              </div>

              {isV31 && (
                <>
                  <p className="modal-sub" style={{ marginTop: "4px" }}>
                    Параметры 3.1. S1–S4 должны быть не меньше 12. Ключ защиты заголовков одинаковый у сервера и
                    клиентов, его создаёт <code>awg genkey</code>.
                  </p>
                  <div className="field">
                    <label>HeaderProtectionKey (32 байта в base64, 44 символа)</label>
                    <input
                      value={form.headerProtectionKey || ""}
                      onChange={(e) => set("headerProtectionKey", e.target.value.trim())}
                      placeholder="например, результат awg genkey"
                      required
                      pattern="[A-Za-z0-9+/]{43}="
                      title="44 символа base64, на конце «=»"
                    />
                  </div>
                  <div className="field">
                    <label>ContentPaddingAddition</label>
                    <input
                      value={form.contentPaddingAddition || ""}
                      onChange={(e) => set("contentPaddingAddition", e.target.value.trim())}
                      placeholder="0-64"
                      required
                      pattern="\d+(-\d+)?"
                      title="число или диапазон, например 0-64"
                    />
                  </div>
                  <div className="field">
                    <label>RandomTrailers / DisableCookies</label>
                    <div className="awg-short-grid awg-flags">
                      <select className="assign-select" value={form.randomTrailers || "on"} onChange={(e) => set("randomTrailers", e.target.value)}>
                        <option value="on">RandomTrailers: on</option>
                        <option value="off">RandomTrailers: off</option>
                      </select>
                      <select className="assign-select" value={form.disableCookies || "off"} onChange={(e) => set("disableCookies", e.target.value)}>
                        <option value="off">DisableCookies: off</option>
                        <option value="on">DisableCookies: on</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={onClose}>
                  Отмена
                </button>
                <button className="btn-primary" disabled={loading}>
                  {loading ? "…" : isEditing ? "Сохранить" : "Добавить"}
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
