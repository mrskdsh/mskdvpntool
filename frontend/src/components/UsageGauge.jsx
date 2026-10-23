import "./UsageGauge.css";

export default function UsageGauge({ usedGB, limitGB, size = 96 }) {
  const compact = size < 90;
  const radius = size / 2 - 8;
  const circumference = Math.PI * radius;
  const ratio = limitGB ? Math.min(1, usedGB / limitGB) : 0.18;
  const dash = circumference * ratio;

  let color = "var(--green)";
  if (limitGB) {
    if (ratio > 0.9) color = "var(--red)";
    else if (ratio > 0.65) color = "var(--accent)";
  }

  const cx = size / 2;
  const cy = size / 2;
  const height = size / 2 + (compact ? 8 : 14);

  return (
    <div className={`gauge ${compact ? "gauge--compact" : ""}`} style={{ width: size, height }}>
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`}>
        <path
          d={`M 8 ${cy} A ${radius} ${radius} 0 0 1 ${size - 8} ${cy}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={compact ? "5" : "7"}
          strokeLinecap="round"
        />
        <path
          d={`M 8 ${cy} A ${radius} ${radius} 0 0 1 ${size - 8} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={compact ? "5" : "7"}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.5s ease, stroke 0.3s ease" }}
        />
      </svg>
      <div className="gauge-value">
        <span className="gauge-number">
          {usedGB >= 100 ? Math.round(usedGB) : usedGB.toFixed(1)}
        </span>
        {!compact && (
          <span className="gauge-unit">
            {limitGB ? `/ ${limitGB} ГБ` : "ГБ · без лимита"}
          </span>
        )}
        {compact && <span className="gauge-unit">{limitGB ? `/${limitGB}` : "ГБ"}</span>}
      </div>
    </div>
  );
}
