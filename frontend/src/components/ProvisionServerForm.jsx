import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import VersionChoice from "./VersionChoice.jsx";
import ProtocolChoice from "./ProtocolChoice.jsx";
import "./CreatePeerModal.css";
import "../pages/Login.css";
import "./ProvisionServerForm.css";

const POLL_MS = 1500;

const EMPTY = {
  name: "",
  protocol: "awg",
  awgVersion: "2",
  xraySni: "",
  location: "local",
  serverIp: "",
  sshHost: "",
  sshUser: "root",
  sshAuth: "password",
  sshPassword: "",
  sshKeyPath: "",
  wgPort: "",
};

// Форма «Создать новый сервер»: панель сама разворачивает выбранный протокол и добавляет сервер.
export default function ProvisionServerForm({ onClose, onProvisioned, onBusyChange, onPhaseChange }) {
  const [form, setForm] = useState(EMPTY);
  const [phase, setPhase] = useState("form"); // form | running | done | error
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const logRef = useRef(null);
  const notifiedRef = useRef(false);

  const isRemote = form.location === "ssh";
  const isXray = ["vless-reality", "hysteria2", "shadowsocks"].includes(form.protocol);
  const isShadowsocks = form.protocol === "shadowsocks";
  const isHysteria = form.protocol === "hysteria2";

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  useEffect(() => {
    onBusyChange?.(phase === "running" || submitting);
  }, [phase, submitting, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => () => onPhaseChange?.("form"), [onPhaseChange]);

  useEffect(() => {
    if (phase !== "running" || !job?.id) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await api.getProvisionJob(job.id);
        if (cancelled) return;
        setJob(next);
        if (next.status === "done") setPhase("done");
        if (next.status === "error") setPhase("error");
      } catch (e) {
        if (cancelled) return;
        setError(e.message);
        setPhase("error");
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, job?.id]);

  useEffect(() => {
    if (phase === "done" && !notifiedRef.current) {
      notifiedRef.current = true;
      onProvisioned?.();
    }
  }, [phase, onProvisioned]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log?.length]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        protocol: form.protocol,
        location: form.location,
        wgPort: form.wgPort || undefined,
      };
      if (form.protocol === "vless-reality") payload.xraySni = form.xraySni || undefined;
      else if (form.protocol === "awg") payload.awgVersion = form.awgVersion;
      if (isRemote) {
        Object.assign(payload, {
          sshHost: form.sshHost,
          sshUser: form.sshUser,
          sshAuth: form.sshAuth,
        });
        if (form.sshAuth === "password") payload.sshPassword = form.sshPassword;
        else payload.sshKeyPath = form.sshKeyPath;
      } else {
        payload.serverIp = form.serverIp;
      }
      const started = await api.provisionServer(payload);
      // Пароль больше не нужен: убираем его из памяти страницы сразу после отправки
      payload.sshPassword = undefined;
      setForm((f) => ({ ...f, sshPassword: "" }));
      notifiedRef.current = false;
      setJob(started);
      setPhase("running");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function backToForm() {
    // Пароль не сохраняем даже в форме: при повторной попытке его нужно ввести заново
    setForm((f) => ({ ...f, sshPassword: "" }));
    setPhase("form");
  }

  if (phase !== "form") {
    const log = job?.log || [];
    return (
      <div className="prov-progress">
        {phase === "running" && (
          <p className="prov-status">
            <span className="prov-spinner" aria-hidden="true" />
            Идёт развёртывание, обычно 1–3 минуты. Не закрывайте окно.
          </p>
        )}
        {phase === "done" && <p className="prov-status prov-ok">Сервер «{form.name}» создан и добавлен в панель.</p>}
        {phase === "error" && (
          <p className="prov-status prov-fail">{error || job?.error || "Развёртывание не удалось."}</p>
        )}

        {phase === "done" && job?.warnings?.length > 0 && (
          <div className="prov-warnings">
            {job.warnings.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
          </div>
        )}

        <pre className="prov-log" ref={logRef} aria-label="Журнал развёртывания">
          {log.length ? log.join("\n") : "Запускаю…"}
        </pre>

        <div className="modal-actions">
          {phase === "error" && (
            <>
              <button type="button" className="btn-ghost" onClick={onClose}>
                Закрыть
              </button>
              <button type="button" className="btn-primary" onClick={backToForm}>
                Назад
              </button>
            </>
          )}
          {phase === "done" && (
            <button type="button" className="btn-primary" onClick={onClose}>
              Готово
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label>Название</label>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Например, Нидерланды"
          maxLength={60}
          required
        />
      </div>

      <div className="field">
        <label>Протокол</label>
        <ProtocolChoice value={form.protocol} onChange={(v) => set("protocol", v)} />
      </div>

      {isShadowsocks ? (
        <p className="prov-hint">
          Панель создаст ключ сервера, а у каждого клиента будет свой ключ. Порт работает и по TCP, и по UDP: его нужно
          открыть в firewall сервера и у хостера для обоих. Протокол попроще и не маскируется, как REALITY, поэтому
          лучше держать его запасным.
        </p>
      ) : isHysteria ? (
        <p className="prov-hint">
          Панель создаст самоподписанный сертификат на 10 лет, его отпечаток попадёт в ссылку клиента. Порт работает по
          UDP: его нужно открыть в firewall сервера и у хостера как UDP.
        </p>
      ) : isXray ? (
        <div className="field">
          <label>Под какой сайт маскироваться (необязательно)</label>
          <input
            value={form.xraySni}
            onChange={(e) => set("xraySni", e.target.value.trim())}
            placeholder="www.microsoft.com"
            maxLength={253}
          />
          <p className="prov-hint prov-hint-tight">
            REALITY выглядит для посторонних как обычное подключение к этому сайту. Подойдёт любой крупный сайт с
            HTTPS; если не уверены, оставьте поле пустым.
          </p>
        </div>
      ) : (
        <div className="field">
          <label>Версия AmneziaWG</label>
          <VersionChoice value={form.awgVersion} onChange={(v) => set("awgVersion", v)} />
        </div>
      )}

      <div className="field">
        <label>Где развернуть</label>
        <div className="login-mode-tabs">
          <button
            type="button"
            className={`login-mode-tab ${!isRemote ? "active" : ""}`}
            onClick={() => set("location", "local")}
          >
            На этой машине
          </button>
          <button
            type="button"
            className={`login-mode-tab ${isRemote ? "active" : ""}`}
            onClick={() => set("location", "ssh")}
          >
            Другой сервер (SSH)
          </button>
        </div>
      </div>

      {isRemote ? (
        <>
          <div className="field">
            <label>IP или домен удалённого сервера</label>
            <input
              value={form.sshHost}
              onChange={(e) => set("sshHost", e.target.value.trim())}
              placeholder="5.6.7.8"
              required
            />
          </div>
          <div className="field">
            <label>SSH-пользователь</label>
            <input value={form.sshUser} onChange={(e) => set("sshUser", e.target.value.trim())} placeholder="root" required />
          </div>
          <div className="field">
            <label>Как панель войдёт на сервер</label>
            <div className="login-mode-tabs">
              <button
                type="button"
                className={`login-mode-tab ${form.sshAuth === "password" ? "active" : ""}`}
                onClick={() => set("sshAuth", "password")}
              >
                Создать ключ по паролю
              </button>
              <button
                type="button"
                className={`login-mode-tab ${form.sshAuth === "key" ? "active" : ""}`}
                onClick={() => set("sshAuth", "key")}
              >
                Ключ уже есть
              </button>
            </div>
          </div>

          {form.sshAuth === "password" ? (
            <>
              <div className="field">
                <label>Пароль от сервера (пользователь {form.sshUser || "root"})</label>
                <input
                  type="password"
                  value={form.sshPassword}
                  onChange={(e) => set("sshPassword", e.target.value)}
                  autoComplete="new-password"
                  maxLength={256}
                  required
                />
              </div>
              <p className="prov-hint">
                Пароль используется один раз, чтобы создать и установить SSH-ключ, и нигде не сохраняется: ни в базе,
                ни в журнале. Дальше панель заходит только по ключу. Пароль передаётся только по HTTPS или через
                SSH-туннель.
              </p>
            </>
          ) : (
            <>
              <div className="field">
                <label>Путь к приватному SSH-ключу на этой машине</label>
                <input
                  value={form.sshKeyPath}
                  onChange={(e) => set("sshKeyPath", e.target.value.trim())}
                  placeholder="/root/.ssh/id_ed25519"
                  required
                />
              </div>
              <p className="prov-hint">
                Ключ без пароля, уже добавленный на сервер. Подойдёт и ключ, который создал скрипт add-server.sh.
              </p>
            </>
          )}
        </>
      ) : (
        <div className="field">
          <label>Публичный IP или домен этого сервера (его увидят клиенты)</label>
          <input
            value={form.serverIp}
            onChange={(e) => set("serverIp", e.target.value.trim())}
            placeholder="1.2.3.4"
            required
          />
        </div>
      )}

      <div className="field">
        <label>{isShadowsocks ? "Порт (TCP и UDP, необязательно)" : isHysteria ? "Порт (UDP, необязательно)" : isXray ? "Порт (TCP, необязательно)" : "Порт WireGuard (необязательно)"}</label>
        <input
          value={form.wgPort}
          onChange={(e) => set("wgPort", e.target.value.replace(/\D/g, ""))}
          placeholder={isXray ? "443, если свободен" : "подберётся автоматически"}
          inputMode="numeric"
        />
      </div>

      <p className="prov-hint">
        {isXray
          ? `Панель скачает Xray проверенной версии, сгенерирует ${isHysteria ? "сертификат" : isShadowsocks ? "ключ сервера" : "ключи REALITY"}, откроет порт в ufw (если он включён) и добавит сервер в список. Если на машине нет Docker, он установится автоматически.`
          : "Панель сама подберёт имя контейнера и подсеть, сгенерирует ключи и параметры, откроет порт в ufw (если он включён) и добавит сервер в список. Если на машине нет Docker, он установится автоматически."}
      </p>

      {error && <p className="error-text">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn-primary" disabled={submitting}>
          {submitting ? "Запускаю…" : "Создать сервер"}
        </button>
      </div>
    </form>
  );
}
