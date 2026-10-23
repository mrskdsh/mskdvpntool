import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api.js";
import "./Login.css";
import "../components/CreatePeerModal.css";

function loadTurnstileScript() {
  if (window.turnstile || document.getElementById("turnstile-script")) return;
  const script = document.createElement("script");
  script.id = "turnstile-script";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  document.body.appendChild(script);
}

export default function Login({ onLoggedIn }) {
  const [mode, setMode] = useState("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);

  const turnstileToken = useRef(null);
  const widgetId = useRef(null);
  const turnstileDiv = useRef(null);

  useEffect(() => {
    api.authConfig().then(setConfig).catch(() => setConfig({ captchaSiteKey: null, inviteRequired: false }));
  }, []);

  useEffect(() => {
    if (mode !== "register" || !config?.captchaSiteKey) return;
    loadTurnstileScript();

    const renderWidget = () => {
      if (!window.turnstile || !turnstileDiv.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(turnstileDiv.current, {
        sitekey: config.captchaSiteKey,
        callback: (token) => {
          turnstileToken.current = token;
        },
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const interval = setInterval(() => {
        if (window.turnstile) {
          renderWidget();
          clearInterval(interval);
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [mode, config]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await api.login(login.trim(), password.trim());
      } else {
        if (config?.captchaSiteKey && !turnstileToken.current) {
          throw new Error("Подтвердите, что вы не робот");
        }
        await api.register(login.trim(), password.trim(), {
          inviteCode: inviteCode.trim(),
          turnstileToken: turnstileToken.current,
        });
      }
      onLoggedIn();
    } catch (err) {
      setError(err.message);
      if (window.turnstile && widgetId.current) {
        window.turnstile.reset(widgetId.current);
        turnstileToken.current = null;
      }
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  return (
    <div className="login-screen">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="login-mark">
          <span className="login-mark-dot" />
        </div>
        <h1 className="login-title">Mr. Skdsh VPN</h1>
        <p className="login-sub">
          {mode === "login"
            ? "Доступ к вашему VPN и остатку трафика"
            : "Создайте аккаунт — доступ выдаст админ по заявке"}
        </p>

        <div className="login-mode-tabs">
          <button
            className={`login-mode-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => switchMode("login")}
            type="button"
          >
            Войти
          </button>
          <button
            className={`login-mode-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => switchMode("register")}
            type="button"
          >
            Регистрация
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Логин</label>
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 6 : undefined}
            />
          </div>
          {mode === "register" && config?.inviteRequired && (
            <div className="field">
              <label>Код приглашения</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="узнайте у администратора"
                required
              />
            </div>
          )}
          {mode === "register" && config?.captchaSiteKey && (
            <div className="field" ref={turnstileDiv} />
          )}
          {error && <p className="error-text">{error}</p>}
          <button className="btn-primary login-submit" disabled={loading}>
            {loading
              ? mode === "login"
                ? "Входим…"
                : "Создаём…"
              : mode === "login"
              ? "Войти"
              : "Зарегистрироваться"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
