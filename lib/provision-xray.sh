#!/bin/bash
# Развёртывание Xray (VLESS + REALITY) на сервере: локально или по SSH.
# Использует те же вспомогательные функции для SSH, что и provision-awg.sh (ssh_preflight и т.д.),
# поэтому вызывающий код сначала делает: source lib/provision-awg.sh; source lib/provision-xray.sh
#
# Как это устроено:
#   - бинарник Xray скачивается с GitHub Releases ФИКСИРОВАННОЙ версии и проверяется по SHA-256;
#   - запускается в docker-контейнере на лёгком образе alpine (свой образ тянуть не нужно);
#   - конфиг лежит на сервере в /opt/skdsh-panel/xray-<имя>/config.json, панель потом сама правит список клиентов;
#   - REALITY маскируется под настоящий сайт (SNI), отдельный домен и сертификат не нужны.
#
# Входные переменные: CONTAINER_NAME, XRAY_PORT (443), XRAY_API_PORT (10085, слушает только 127.0.0.1),
#   XRAY_SNI (www.microsoft.com), XRAY_MODE (reality — VLESS+REALITY, по умолчанию; hysteria2 — Hysteria2 с
#   самоподписанным сертификатом, порт UDP; shadowsocks — Shadowsocks-2022, один порт TCP и UDP), IS_REMOTE, а для удалённого — SSH_HOST, SSH_USER, SSH_KEY.

XRAY_VERSION="26.3.27"
XRAY_BASE_IMAGE="alpine:3.20"

provision_xray_server() {
  XRAY_PORT="${XRAY_PORT:-443}"
  # Список портов на выбор: берётся первый свободный на самой машине (например, 443/tcp часто занят веб-сервером панели)
  XRAY_PORT_CANDIDATES="${XRAY_PORT_CANDIDATES:-$XRAY_PORT}"
  XRAY_API_PORT="${XRAY_API_PORT:-10085}"
  XRAY_SNI="${XRAY_SNI:-www.microsoft.com}"
  XRAY_MODE="${XRAY_MODE:-reality}"
  local proto=tcp
  [ "$XRAY_MODE" = "hysteria2" ] && proto=udp
  [ "$XRAY_MODE" = "shadowsocks" ] && proto=tcp+udp

  local script
  script=$(cat << PROVISION_EOF
set -e
IMAGE="$XRAY_BASE_IMAGE"
XRAY_VERSION="$XRAY_VERSION"
CONTAINER_NAME="$CONTAINER_NAME"
XRAY_PORT="$XRAY_PORT"
API_PORT="$XRAY_API_PORT"
SNI="$XRAY_SNI"
MODE="$XRAY_MODE"
PROTO="$proto"
CANDIDATES="$XRAY_PORT_CANDIDATES"

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
fi

if command -v ss &> /dev/null; then
  SSF="-ltn"
  [ "\$PROTO" = "udp" ] && SSF="-lun"
  [ "\$PROTO" = "tcp+udp" ] && SSF="-ltun"
  CHOSEN=""
  for CAND in \$CANDIDATES; do
    if ! ss \$SSF 2>/dev/null | awk '{print \$4" "\$5}' | grep -Eq ":\$CAND( |\$)"; then
      CHOSEN="\$CAND"
      break
    fi
  done
  if [ -z "\$CHOSEN" ]; then
    echo "ERROR: порт \$CANDIDATES на сервере уже занят другой программой — укажите другой порт"
    exit 1
  fi
  XRAY_PORT="\$CHOSEN"
fi

case "\$(uname -m)" in
  x86_64|amd64) ARCH="64" ;;
  aarch64|arm64) ARCH="arm64-v8a" ;;
  *) echo "ERROR: архитектура \$(uname -m) не поддерживается"; exit 1 ;;
esac

BIN_DIR="/opt/skdsh-panel/xray-bin/\$XRAY_VERSION"
BIN="\$BIN_DIR/xray"
if [ ! -x "\$BIN" ]; then
  mkdir -p "\$BIN_DIR"
  URL="https://github.com/XTLS/Xray-core/releases/download/v\$XRAY_VERSION/Xray-linux-\$ARCH.zip"
  docker pull "\$IMAGE" > /dev/null
  docker run --rm -v "\$BIN_DIR:/out" "\$IMAGE" sh -c "set -e; \
    wget -qO /tmp/x.zip '\$URL'; wget -qO /tmp/x.dgst '\$URL.dgst'; \
    SUM=\\\$(grep '^SHA2-256=' /tmp/x.dgst | awk '{print \\\$2}'); \
    [ -n \"\\\$SUM\" ]; echo \"\\\$SUM  /tmp/x.zip\" | sha256sum -c - > /dev/null; \
    unzip -o -q /tmp/x.zip xray -d /out" || { echo "ERROR: не удалось скачать или проверить Xray"; rm -rf "\$BIN_DIR"; exit 1; }
  chmod 755 "\$BIN"
fi

xr() { docker run --rm -v "\$BIN:/usr/local/bin/xray:ro" "\$IMAGE" /usr/local/bin/xray "\$@"; }
xr_ro_hash() { docker run --rm -v "\$BIN:/usr/local/bin/xray:ro" -v "\$CONFIG_DIR:/etc/xray:ro" "\$IMAGE" /usr/local/bin/xray tls hash --cert /etc/xray/hy2.crt | awk '{print \$NF}'; }

CONFIG_DIR="/opt/skdsh-panel/xray-\$CONTAINER_NAME"
mkdir -p "\$CONFIG_DIR"
PRIVATE_KEY=""
PUBLIC_KEY=""
SHORT_ID=""
PIN_SHA256=""
SS_KEY=""
if [ "\$MODE" = "shadowsocks" ]; then
  # Ключ сервера Shadowsocks-2022 (16 байт в base64); у каждого клиента потом свой ключ такой же длины
  SS_KEY=\$(head -c 16 /dev/urandom | base64)
  PUBLIC_KEY="\$SS_KEY"
elif [ "\$MODE" = "hysteria2" ]; then
  # Самоподписанный сертификат на 10 лет; клиент проверяет сервер по отпечатку (он попадает в ссылку)
  docker run --rm -v "\$BIN:/usr/local/bin/xray:ro" -v "\$CONFIG_DIR:/etc/xray" "\$IMAGE" /usr/local/bin/xray tls cert -domain="\$SNI" -name="\$SNI" -org="Mr. Skdsh VPN" -file=/etc/xray/hy2 -expire=87600h > /dev/null
  chmod 600 "\$CONFIG_DIR/hy2.key"
  chmod 644 "\$CONFIG_DIR/hy2.crt"
  HASH=\$(xr_ro_hash)
  if [ "\${#HASH}" -ne 64 ]; then
    echo "ERROR: не удалось создать сертификат"
    exit 1
  fi
  PIN_SHA256=\$(echo "\$HASH" | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:\$//')
else
  KEYS=\$(xr x25519)
  PRIVATE_KEY=\$(echo "\$KEYS" | awk 'tolower(\$0) ~ /private ?key/ {print \$NF; exit}')
  PUBLIC_KEY=\$(echo "\$KEYS" | awk 'tolower(\$0) ~ /public ?key|password/ {print \$NF; exit}')
  if [ -z "\$PRIVATE_KEY" ] || [ -z "\$PUBLIC_KEY" ]; then
    echo "ERROR: не удалось создать ключи REALITY"
    exit 1
  fi
  SHORT_ID=\$(od -An -tx1 -N8 /dev/urandom | tr -d ' \n')
fi

if [ "\$MODE" = "shadowsocks" ]; then
cat > "\$CONFIG_DIR/config.json" << CONF_EOF
{
  "log": { "loglevel": "warning" },
  "stats": {},
  "api": { "tag": "api", "services": ["StatsService", "HandlerService"] },
  "policy": {
    "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } }
  },
  "inbounds": [
    {
      "tag": "api",
      "listen": "127.0.0.1",
      "port": \$API_PORT,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    },
    {
      "tag": "shadowsocks",
      "listen": "0.0.0.0",
      "port": \$XRAY_PORT,
      "protocol": "shadowsocks",
      "settings": {
        "method": "2022-blake3-aes-128-gcm",
        "password": "\$SS_KEY",
        "network": "tcp,udp",
        "clients": []
      }
    }
  ],
  "outbounds": [
    { "tag": "direct", "protocol": "freedom" },
    { "tag": "block", "protocol": "blackhole" }
  ],
  "routing": {
    "rules": [{ "type": "field", "inboundTag": ["api"], "outboundTag": "api" }]
  }
}
CONF_EOF
elif [ "\$MODE" = "hysteria2" ]; then
cat > "\$CONFIG_DIR/config.json" << CONF_EOF
{
  "log": { "loglevel": "warning" },
  "stats": {},
  "api": { "tag": "api", "services": ["StatsService", "HandlerService"] },
  "policy": {
    "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } }
  },
  "inbounds": [
    {
      "tag": "api",
      "listen": "127.0.0.1",
      "port": \$API_PORT,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    },
    {
      "tag": "hysteria2",
      "listen": "0.0.0.0",
      "port": \$XRAY_PORT,
      "protocol": "hysteria",
      "settings": { "version": 2, "clients": [] },
      "streamSettings": {
        "network": "hysteria",
        "security": "tls",
        "tlsSettings": {
          "alpn": ["h3"],
          "certificates": [{ "certificateFile": "/etc/xray/hy2.crt", "keyFile": "/etc/xray/hy2.key" }]
        },
        "hysteriaSettings": { "version": 2 }
      }
    }
  ],
  "outbounds": [
    { "tag": "direct", "protocol": "freedom" },
    { "tag": "block", "protocol": "blackhole" }
  ],
  "routing": {
    "rules": [{ "type": "field", "inboundTag": ["api"], "outboundTag": "api" }]
  }
}
CONF_EOF
else
cat > "\$CONFIG_DIR/config.json" << CONF_EOF
{
  "log": { "loglevel": "warning" },
  "stats": {},
  "api": { "tag": "api", "services": ["StatsService", "HandlerService"] },
  "policy": {
    "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } }
  },
  "inbounds": [
    {
      "tag": "api",
      "listen": "127.0.0.1",
      "port": \$API_PORT,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    },
    {
      "tag": "vless-reality",
      "listen": "0.0.0.0",
      "port": \$XRAY_PORT,
      "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "\$SNI:443",
          "xver": 0,
          "serverNames": ["\$SNI"],
          "privateKey": "\$PRIVATE_KEY",
          "shortIds": ["\$SHORT_ID"]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "tag": "direct", "protocol": "freedom" },
    { "tag": "block", "protocol": "blackhole" }
  ],
  "routing": {
    "rules": [{ "type": "field", "inboundTag": ["api"], "outboundTag": "api" }]
  }
}
CONF_EOF
fi
chmod 600 "\$CONFIG_DIR/config.json"

if ! docker run --rm -v "\$BIN:/usr/local/bin/xray:ro" -v "\$CONFIG_DIR:/etc/xray:ro" "\$IMAGE" /usr/local/bin/xray run -test -c /etc/xray/config.json > /dev/null 2>&1; then
  echo "ERROR: Xray не принял созданный конфиг"
  exit 1
fi

docker rm -f "\$CONTAINER_NAME" > /dev/null 2>&1 || true
docker run -d \
  --name "\$CONTAINER_NAME" \
  --network host \
  --restart always \
  -v "\$BIN:/usr/local/bin/xray:ro" \
  -v "\$CONFIG_DIR:/etc/xray:ro" \
  "\$IMAGE" /usr/local/bin/xray run -c /etc/xray/config.json > /dev/null

sleep 2
if [ -z "\$(docker ps -q --filter "name=^\$CONTAINER_NAME\$" --filter status=running)" ]; then
  echo "ERROR: Xray не запустился, смотрите: docker logs \$CONTAINER_NAME"
  exit 1
fi

FIREWALL="none"
if command -v ufw > /dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  if [ "\$PROTO" = "tcp+udp" ]; then
    ufw allow "\$XRAY_PORT/tcp" > /dev/null 2>&1 && ufw allow "\$XRAY_PORT/udp" > /dev/null 2>&1 && FIREWALL="ufw-opened"
  elif ufw allow "\$XRAY_PORT/\$PROTO" > /dev/null 2>&1; then
    FIREWALL="ufw-opened"
  fi
fi

PORT_LISTENING="unknown"
if command -v ss > /dev/null 2>&1; then
  if ss \$SSF 2>/dev/null | awk '{print \$4" "\$5}' | grep -Eq ":\$XRAY_PORT( |\$)"; then
    PORT_LISTENING="yes"
  else
    PORT_LISTENING="no"
  fi
fi

echo "RESULT_START"
echo "PUBLIC_KEY=\$PUBLIC_KEY"
echo "SHORT_ID=\$SHORT_ID"
echo "PIN_SHA256=\$PIN_SHA256"
echo "SNI=\$SNI"
echo "PORT=\$XRAY_PORT"
echo "API_PORT=\$API_PORT"
echo "XRAY_VERSION=\$XRAY_VERSION"
echo "FIREWALL=\$FIREWALL"
echo "PORT_LISTENING=\$PORT_LISTENING"
echo "RESULT_END"
PROVISION_EOF
)

  local output
  if [ "$IS_REMOTE" = true ]; then
    output=$(ssh "${SSH_BASE_OPTS[@]}" -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "sudo bash -s" <<< "$script" 2>&1) || {
      echo "✗ Ошибка на удалённом сервере:"
      echo "$output"
      return 1
    }
  else
    output=$(bash -c "$script" 2>&1) || {
      echo "✗ Ошибка:"
      echo "$output"
      return 1
    }
  fi

  if ! echo "$output" | grep -q "RESULT_START"; then
    echo "✗ Разворачивание не завершилось успешно. Полный вывод:"
    echo "$output"
    return 1
  fi

  local parsed
  parsed=$(echo "$output" | sed -n '/RESULT_START/,/RESULT_END/p')
  local get_val
  get_val() { echo "$parsed" | grep "^$1=" | cut -d= -f2-; }

  PROV_PUBLIC_KEY=$(get_val PUBLIC_KEY)
  PROV_SHORT_ID=$(get_val SHORT_ID)
  PROV_PIN_SHA256=$(get_val PIN_SHA256)
  PROV_SNI=$(get_val SNI)
  PROV_PORT=$(get_val PORT)
  PROV_API_PORT=$(get_val API_PORT)
  PROV_XRAY_VERSION=$(get_val XRAY_VERSION)
  PROV_FIREWALL=$(get_val FIREWALL)
  PROV_PORT_LISTENING=$(get_val PORT_LISTENING)

  if [ "$PROV_FIREWALL" = "ufw-opened" ]; then
    echo "✓ Порт $XRAY_PORT/${proto/+/ и } открыт в ufw на сервере"
  else
    echo "⚠ Откройте порт $XRAY_PORT/${proto/+/ и } в firewall сервера и в панели хостинга (если у хостера есть свой firewall)"
  fi
  if [ "$PROV_PORT_LISTENING" = "no" ]; then
    echo "⚠ На сервере ничего не слушает порт $XRAY_PORT/${proto/+/ и } — проверьте: docker logs $CONTAINER_NAME"
  fi
}
