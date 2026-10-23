import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api.js";
import "./CreatePeerModal.css";
import "./QrModal.css";

function toBase64(config) {
  const bytes = new TextEncoder().encode(config);
  return btoa(String.fromCharCode(...bytes));
}

function incyLink(config) {
  return `incy://import/${toBase64(config)}`;
}

// Текстовая ссылка из документации incy: awg://<конфиг в base64url>#Имя
function awgTextLink(config, name) {
  const b64url = toBase64(config).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `awg://${b64url}#${encodeURIComponent(name)}`;
}

export default function QrModal({ peer, onClose }) {
  const isAwg3 = peer?.awgVersion === "3.1";
  const isXray = Boolean(peer?.protocol) && peer.protocol !== "awg";
  const [mode, setMode] = useState("amnezia");
  const activeMode = mode;
  const [qr, setQr] = useState(null);
  const [config, setConfig] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!peer) return;
    setMode("amnezia");
  }, [peer]);

  useEffect(() => {
    if (!peer) return;
    let cancelled = false;
    setQr(null);
    setError("");

    // У VLESS одна ссылка на всё: и для QR, и для импорта в приложение
    const request =
      activeMode === "amnezia" || isXray
        ? Promise.all([api.getVpnLinkQr(peer.id), api.getVpnLink(peer.id)]).then(([qrRes, linkRes]) => [
            qrRes.qr,
            linkRes.link,
          ])
        : Promise.all([api.getQr(peer.id), api.getConfig(peer.id)]).then(([qrRes, configRes]) => [
            qrRes.qr,
            configRes.config,
          ]);

    request
      .then(([qrData, text]) => {
        if (cancelled) return;
        setQr(qrData);
        setConfig(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [peer, activeMode, isXray]);

  function copyConfig() {
    navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function copyIncyLink() {
    navigator.clipboard.writeText(awgTextLink(config, peer.name));
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1500);
  }

  function downloadConfig() {
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peer.name.replace(/\s+/g, "_")}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AnimatePresence>
      {peer && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card qr-modal"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">{peer.name}</h2>

            {!isXray && (
              <div className="qr-mode-tabs">
                <button
                  className={`qr-mode-tab ${activeMode === "amnezia" ? "active" : ""}`}
                  onClick={() => setMode("amnezia")}
                >
                  Для AmneziaVPN
                </button>
                <button
                  className={`qr-mode-tab ${activeMode === "raw" ? "active" : ""}`}
                  onClick={() => setMode("raw")}
                >
                  Другие приложения
                </button>
              </div>
            )}

            {error ? (
              <p className="qr-error">{error}</p>
            ) : isXray ? (
              <>
                <p className="modal-sub">
                  Для Happ, v2rayN, v2rayNG, Hiddify и других приложений (VLESS, Hysteria2, Shadowsocks): отсканируйте QR или вставьте
                  ссылку в приложении (значок «+» → «Импорт из буфера обмена»)
                </p>
                <div className="qr-frame">
                  {qr ? <img src={qr} alt="QR-код ссылки" /> : <div className="qr-loading" />}
                </div>
                {config && (
                  <a className="btn-primary qr-download qr-link-btn" href={config}>
                    Открыть в приложении
                  </a>
                )}
                <button className="btn-ghost qr-copy" onClick={copyConfig} disabled={!config}>
                  {copied ? "Скопировано ✓" : "Скопировать ссылку"}
                </button>
              </>
            ) : (
              <>
                <p className="modal-sub">
                  {activeMode === "amnezia"
                    ? isAwg3
                      ? "Сервер на AmneziaWG 3.1, ссылка экспериментальная и ещё не проверена на реальном клиенте (нужен AmneziaVPN 5.0.1.5 или новее). Если не сработает — «Другие приложения»"
                      : "Экспериментально: имя сервера подставится автоматически. Если не сработает — переключитесь на «Другие приложения»"
                    : "Для AmneziaWG, incy и других клиентов с поддержкой AmneziaWG: отсканируйте QR, откройте в incy или скачайте файл"}
                </p>
                <div className="qr-frame">
                  {qr ? (
                    <img src={qr} alt="QR-код конфига" />
                  ) : (
                    <div className="qr-loading" />
                  )}
                </div>
                {activeMode === "raw" && (
                  <>
                    {config && (
                      <a className="btn-primary qr-download qr-link-btn" href={incyLink(config)}>
                        Открыть в incy
                      </a>
                    )}
                    <button className="btn-ghost qr-download" onClick={copyIncyLink} disabled={!config}>
                      {copiedLink ? "Ссылка скопирована ✓" : "Скопировать ссылку для incy"}
                    </button>
                    <button className="btn-ghost qr-download" onClick={downloadConfig} disabled={!config}>
                      Скачать .conf файл
                    </button>
                  </>
                )}
                <button className="btn-ghost qr-copy" onClick={copyConfig} disabled={!config}>
                  {copied ? "Скопировано ✓" : activeMode === "raw" ? "Скопировать текст конфига" : "Скопировать ссылку"}
                </button>
              </>
            )}

            <div className="modal-actions">
              <button className="btn-ghost" onClick={onClose}>
                Готово
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
