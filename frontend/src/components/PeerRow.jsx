import { useState } from "react";
import UsageGauge from "./UsageGauge.jsx";
import "./PeerRow.css";

export default function PeerRow({
  peer,
  busy,
  assignedTo,
  serverName,
  onUpdateLimit,
  onToggleBlock,
  onDelete,
  onShowQr,
  onAssign,
  onRename,
  selectable,
  selected,
  onToggleSelect,
}) {
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState(peer.limitGB ?? "");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(peer.name);

  function saveLimit() {
    const value = limitInput === "" ? null : Number(limitInput);
    onUpdateLimit(peer.id, value);
    setEditingLimit(false);
  }

  function saveName() {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== peer.name) {
      onRename(peer.id, trimmed);
    } else {
      setNameInput(peer.name);
    }
    setEditingName(false);
  }

  function cancelName() {
    setNameInput(peer.name);
    setEditingName(false);
  }

  return (
    <div
      className={[
        "peer-row",
        peer.blocked && "peer-row--blocked",
        selectable && "peer-row--selectable",
        selectable && selected && "peer-row--selected",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={
        selectable
          ? (e) => {
              if (!e.target.closest("button, input")) onToggleSelect(peer.id);
            }
          : undefined
      }
    >
      {selectable && (
        <label className="peer-check">
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={() => onToggleSelect(peer.id)}
            aria-label={`Выбрать «${peer.name}»`}
          />
          <span className="peer-check-box" aria-hidden="true">
            ✓
          </span>
        </label>
      )}
      <UsageGauge usedGB={peer.usedGB} limitGB={peer.limitGB} size={72} />

      <div className="peer-info">
        <div className="peer-name-line">
          {editingName ? (
            <div className="peer-name-edit">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") cancelName();
                }}
                autoFocus
              />
              <button className="btn-ghost peer-name-save" onClick={saveName}>
                ✓
              </button>
            </div>
          ) : (
            <>
              <span className="peer-name">{peer.name}</span>
              <button
                className="peer-name-pencil"
                onClick={() => setEditingName(true)}
                title="Переименовать"
              >
                ✎
              </button>
            </>
          )}
          <span className={`peer-status ${peer.online ? "online" : ""}`}>
            {peer.blocked ? "заблокирован" : peer.online ? "в сети" : "офлайн"}
          </span>
        </div>
        <div className="peer-address">
          {peer.address && peer.address !== "-" ? peer.address : peer.protocol === "vless-reality" ? "VLESS" : peer.protocol === "hysteria2" ? "Hysteria2" : peer.protocol === "shadowsocks" ? "Shadowsocks" : ""}
          {serverName && <span className="peer-server-badge"> · {serverName}</span>}
        </div>
        <button className="peer-assign-btn" onClick={() => onAssign(peer)}>
          {assignedTo ? `→ ${assignedTo}` : "не назначено — назначить"}
        </button>
      </div>

      <div className="peer-limit">
        {editingLimit ? (
          <div className="peer-limit-edit">
            <input
              type="number"
              min="0"
              placeholder="без лимита"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              autoFocus
            />
            <button className="btn-ghost" onClick={saveLimit}>
              ✓
            </button>
          </div>
        ) : (
          <button className="peer-limit-btn" onClick={() => setEditingLimit(true)}>
            {peer.limitGB ? `${peer.limitGB} ГБ` : "без лимита"}
          </button>
        )}
      </div>

      <div className="peer-actions">
        <button className="btn-ghost" onClick={() => onShowQr(peer)} disabled={busy}>
          QR
        </button>
        <button
          className="btn-ghost"
          onClick={() => onToggleBlock(peer.id, !peer.blocked)}
          disabled={busy}
        >
          {busy ? "…" : peer.blocked ? "Разблокировать" : "Заблокировать"}
        </button>
        <button
          className="btn-ghost peer-delete"
          onClick={() => onDelete(peer.id)}
          disabled={busy}
        >
          {busy ? "…" : "Удалить"}
        </button>
      </div>
    </div>
  );
}
