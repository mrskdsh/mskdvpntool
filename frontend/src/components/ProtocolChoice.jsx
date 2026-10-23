// Выбор протокола при создании сервера: карточки в том же стиле, что и выбор версии AmneziaWG.
const PROTOCOLS = [
  { id: "awg", title: "AmneziaWG", hint: "быстрый VPN, приложение AmneziaVPN" },
  { id: "vless-reality", title: "VLESS + REALITY", hint: "Xray, приложения Happ, v2rayN, Hiddify" },
  { id: "hysteria2", title: "Hysteria2", hint: "быстрый протокол на UDP, приложения Happ, Hiddify" },
  { id: "shadowsocks", title: "Shadowsocks-2022", hint: "простой запасной вариант, приложения Happ, v2rayNG, Shadowrocket" },
];

export default function ProtocolChoice({ value, onChange }) {
  return (
    <div className="version-choice protocol-choice" role="radiogroup" aria-label="Протокол">
      {PROTOCOLS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          className={`version-option ${value === p.id ? "active" : ""}`}
          onClick={() => onChange(p.id)}
        >
          <b>{p.title}</b>
          <span>{p.hint}</span>
        </button>
      ))}
    </div>
  );
}
