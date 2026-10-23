import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./CreatePeerModal.css";
import "./ConnectGuide.css";

const AMNEZIA_IOS = "https://apps.apple.com/us/app/amneziavpn/id1600529900";
const AMNEZIA_ANDROID = "https://play.google.com/store/apps/details?id=org.amnezia.vpn";
const AMNEZIA_DESKTOP = "https://amnezia.org/downloads";
const AMNEZIA_RELEASES = "https://github.com/amnezia-vpn/amnezia-client/releases";
const INCY_DOCS = "https://docs.incy.cc/";
const HAPP_SITE = "https://www.happ.su/main";
const HAPP_DL = "https://github.com/Happ-proxy";
const HAPP_IOS = "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215";
const HAPP_IOS_RU = "https://apps.apple.com/ru/app/happ-lite/id6799917773";
const HAPP_ANDROID = "https://play.google.com/store/apps/details?id=com.happproxy";

// Приложения для VLESS по устройствам (ссылки с официального сайта Happ)
const XRAY_LINKS = {
  ios: [
    { text: "Happ в App Store", href: HAPP_IOS },
    { text: "Happ Lite (App Store, Россия)", href: HAPP_IOS_RU },
  ],
  android: [
    { text: "Happ в Google Play", href: HAPP_ANDROID },
    { text: "APK-файл Happ", href: `${HAPP_DL}/happ-android/releases/latest/download/Happ.apk` },
  ],
  windows: [{ text: "Happ для Windows (x64)", href: `${HAPP_DL}/happ-desktop/releases/latest/download/setup-Happ.x64.exe` }],
  mac: [
    { text: "Happ в App Store", href: HAPP_IOS },
    { text: "Happ для macOS (DMG)", href: `${HAPP_DL}/happ-desktop/releases/latest/download/Happ.macOS.universal.dmg` },
  ],
  linux: [
    { text: "Happ .deb (x64)", href: `${HAPP_DL}/happ-desktop/releases/latest/download/Happ.linux.x64.deb` },
    { text: "Happ .rpm (x64)", href: `${HAPP_DL}/happ-desktop/releases/latest/download/Happ.linux.x64.rpm` },
  ],
};
const XRAY_ALTERNATIVES = [
  { text: "v2rayNG (Android)", href: "https://github.com/2dust/v2rayNG/releases" },
  { text: "v2rayN (Windows)", href: "https://github.com/2dust/v2rayN/releases" },
  { text: "Hiddify (все платформы)", href: "https://github.com/hiddify/hiddify-app/releases" },
];

const DEVICES = [
  {
    id: "ios",
    label: "iPhone / iPad",
    phone: true,
    installLinks: [{ text: "AmneziaVPN в App Store", href: AMNEZIA_IOS }],
    incy: true,
  },
  {
    id: "android",
    label: "Android",
    phone: true,
    installLinks: [
      { text: "AmneziaVPN в Google Play", href: AMNEZIA_ANDROID },
      { text: "APK на GitHub", href: AMNEZIA_RELEASES },
    ],
    incy: true,
  },
  {
    id: "windows",
    label: "Windows",
    installLinks: [
      { text: "AmneziaVPN для Windows", href: AMNEZIA_DESKTOP },
      { text: "Все версии на GitHub", href: AMNEZIA_RELEASES },
    ],
  },
  {
    id: "mac",
    label: "macOS",
    installLinks: [
      { text: "AmneziaVPN для macOS", href: AMNEZIA_DESKTOP },
      { text: "Все версии на GitHub", href: AMNEZIA_RELEASES },
    ],
  },
  {
    id: "linux",
    label: "Linux",
    installLinks: [
      { text: "AmneziaVPN для Linux", href: AMNEZIA_DESKTOP },
      { text: "Все версии на GitHub", href: AMNEZIA_RELEASES },
    ],
  },
];

function detectDevice() {
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
    if (/Android/i.test(ua)) return "android";
    if (/Windows/i.test(ua)) return "windows";
    if (/Mac/i.test(ua)) return "mac";
    if (/Linux/i.test(ua)) return "linux";
  } catch {
    // без определения устройства просто покажем первую вкладку
  }
  return "android";
}

export default function ConnectGuide({ open, onClose }) {
  const [deviceId, setDeviceId] = useState("android");
  const [proto, setProto] = useState("awg");

  useEffect(() => {
    if (open) setDeviceId(detectDevice());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const device = DEVICES.find((d) => d.id === deviceId) || DEVICES[0];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop guide-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card guide-card"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Как подключиться"
          >
            <h2 className="modal-title">Как подключиться</h2>
            <p className="modal-sub">Выберите своё устройство, и мы покажем, что установить и куда нажать</p>

            <div className="guide-devices" role="tablist" aria-label="Протокол">
              <button
                role="tab"
                aria-selected={proto === "awg"}
                className={`guide-device ${proto === "awg" ? "active" : ""}`}
                onClick={() => setProto("awg")}
              >
                AmneziaWG
              </button>
              <button
                role="tab"
                aria-selected={proto === "xray"}
                className={`guide-device ${proto === "xray" ? "active" : ""}`}
                onClick={() => setProto("xray")}
              >
                VLESS, Hysteria2, Shadowsocks (Happ и др.)
              </button>
            </div>

            <div className="guide-devices" role="tablist" aria-label="Устройство">
              {DEVICES.map((d) => (
                <button
                  key={d.id}
                  role="tab"
                  aria-selected={d.id === deviceId}
                  className={`guide-device ${d.id === deviceId ? "active" : ""}`}
                  onClick={() => setDeviceId(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {proto === "xray" ? (
              <>
                <section className="guide-section">
                  <h3 className="guide-h">Приложение Happ</h3>
                  <ol className="guide-steps">
                    <li>
                      <b>Установите Happ.</b>
                      <span className="guide-links">
                        {XRAY_LINKS[device.id].map((l) => (
                          <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener">
                            {l.text}
                          </a>
                        ))}
                        <a href={HAPP_SITE} target="_blank" rel="noreferrer noopener">
                          Сайт Happ
                        </a>
                      </span>
                    </li>
                    <li>
                      <b>Возьмите ссылку в панели.</b> У нужного доступа нажмите «QR» и затем «Скопировать ссылку».
                      Копируйте целиком: ссылка начинается с <span className="guide-key">vless://</span>,{" "}
                      <span className="guide-key">hysteria2://</span> или <span className="guide-key">ss://</span>.
                    </li>
                    <li>
                      <b>Добавьте её в Happ.</b> Нажмите <span className="guide-key">+</span> (вверху справа) и
                      выберите добавление из буфера обмена.
                      Названия пунктов могут немного отличаться в разных версиях.
                    </li>
                    <li>
                      <b>Подключитесь.</b> Выберите добавленный сервер в списке и включите подключение.
                    </li>
                  </ol>
                  <p className="guide-alt">
                    {device.phone
                      ? "На телефоне проще так: откройте окно «QR» прямо на нём и нажмите «Открыть в приложении», либо отсканируйте QR-код с другого экрана."
                      : "На компьютере можно отсканировать QR-код телефоном: в приложении на телефоне нажмите «+» и выберите сканирование QR."}
                  </p>
                </section>

                <section className="guide-section">
                  <h3 className="guide-h">Другие приложения</h3>
                  <p className="guide-alt">
                    Эти ссылки подойдут и другим клиентам с поддержкой VLESS+REALITY, Hysteria2 и Shadowsocks-2022:
                    <span className="guide-links">
                      {XRAY_ALTERNATIVES.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener">
                          {l.text}
                        </a>
                      ))}
                    </span>
                  </p>
                </section>

                <section className="guide-section guide-note">
                  <h3 className="guide-h">Важно знать</h3>
                  <ul className="guide-list">
                    <li>Берите ссылки только из этой панели. Ссылки из чужих источников могут перехватывать ваши данные.</li>
                    <li>Один доступ — одно устройство. Для второго устройства попросите отдельный доступ.</li>
                    <li>Если подключение не устанавливается, проверьте, что на устройстве верно выставлены дата и время.</li>
                    <li>
                      Hysteria2 работает по UDP. В некоторых сетях (часть мобильных операторов, корпоративный Wi-Fi) UDP
                      закрыт, тогда используйте доступ на VLESS.
                    </li>
                    <li>
                      Shadowsocks-2022 — запасной вариант без маскировки: не все старые приложения его понимают, нужна свежая версия.
                    </li>
                  </ul>
                </section>
              </>
            ) : (
              <>
            <section className="guide-section">
              <h3 className="guide-h">Способ 1. Приложение AmneziaVPN</h3>
              <ol className="guide-steps">
                <li>
                  <b>Установите приложение.</b>
                  <span className="guide-links">
                    {device.installLinks.map((l) => (
                      <a key={l.href + l.text} href={l.href} target="_blank" rel="noreferrer noopener">
                        {l.text}
                      </a>
                    ))}
                  </span>
                </li>
                <li>
                  <b>Возьмите ключ в панели.</b> У нужного доступа нажмите «QR», затем на вкладке «Для AmneziaVPN»
                  нажмите «Скопировать ссылку». Копируйте ключ целиком: если пропадёт хоть один символ, приложение
                  выдаст ошибку.
                </li>
                <li>
                  <b>Добавьте подключение.</b> В приложении нажмите «Начать» (если подключений ещё нет) или значок{" "}
                  <span className="guide-key">+</span>. Нажмите «Вставить», затем «Продолжить» и «Подключиться».
                </li>
              </ol>
              <p className="guide-alt">
                <b>Если ключ не подошёл:</b> в окне «QR» на вкладке «Другие приложения» нажмите «Скачать .conf
                файл». В приложении нажмите <span className="guide-key">+</span> → «Файл настроек подключения»,
                выберите скачанный файл и нажмите «Продолжить» → «Подключиться».
                {device.phone && " На телефоне также можно отсканировать QR-код с другого экрана."}
              </p>
            </section>

            {device.incy ? (
              <section className="guide-section">
                <h3 className="guide-h">Способ 2. Приложение incy</h3>
                <ol className="guide-steps">
                  <li>
                    <b>Установите incy</b> из магазина приложений. Инструкция и подробности:{" "}
                    <a href={INCY_DOCS} target="_blank" rel="noreferrer noopener">
                      docs.incy.cc
                    </a>
                    .
                  </li>
                  <li>
                    <b>Передайте доступ.</b> Откройте окно «QR» прямо на этом телефоне, перейдите на вкладку «Другие
                    приложения» и нажмите «Открыть в incy». Либо нажмите «Скопировать ссылку для incy» и вставьте её
                    в приложении.
                  </li>
                </ol>
              </section>
            ) : (
              <section className="guide-section guide-muted">
                <h3 className="guide-h">Другие приложения</h3>
                <p className="guide-alt">
                  incy работает с AmneziaWG только на iOS и Android. На компьютере используйте AmneziaVPN.
                </p>
              </section>
            )}

            <section className="guide-section guide-note">
              <h3 className="guide-h">Важно знать</h3>
              <ul className="guide-list">
                <li>
                  Если сервер на <b>AmneziaWG 3.1</b>, нужна свежая версия AmneziaVPN: 5.0.1.5 или новее. Ссылка для
                  AmneziaVPN у 3.1 экспериментальная: если не сработает, используйте файл .conf или incy.
                </li>
                <li>Берите ключи и файлы только из этой панели. Ключи из чужих источников могут перехватывать ваши данные.</li>
                <li>Один доступ — одно устройство. Для второго устройства попросите отдельный доступ.</li>
              </ul>
            </section>
              </>
            )}

            <div className="modal-actions">
              <button className="btn-primary" onClick={onClose}>
                Понятно
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
