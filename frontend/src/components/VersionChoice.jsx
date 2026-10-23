// Выбор версии AmneziaWG: две карточки. Используется при создании и при подключении сервера.
export default function VersionChoice({ value, onChange }) {
  const isV31 = value === "3.1";
  return (
    <div className="version-choice" role="radiogroup" aria-label="Версия AmneziaWG">
      <button
        type="button"
        role="radio"
        aria-checked={!isV31}
        className={`version-option ${!isV31 ? "active" : ""}`}
        onClick={() => onChange("2")}
      >
        <b>2.0</b>
        <span>проверенная, работает со всеми клиентами</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={isV31}
        className={`version-option ${isV31 ? "active" : ""}`}
        onClick={() => onChange("3.1")}
      >
        <b>3.1</b>
        <span>экспериментально, нужны свежие приложения</span>
      </button>
    </div>
  );
}
