#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/provision-awg.sh"

echo "=== Mr. Skdsh VPN — установка ==="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Запустите с sudo: sudo ./install.sh"
  exit 1
fi

echo "Как устанавливаем?"
echo "  1) Всё на одном сервере: панель и VPN вместе (по умолчанию)"
echo "  2) Панель здесь (например, на российском хостинге), а VPN-сервер за рубежом, по SSH"
read -p "Выберите [1]: " INSTALL_MODE
if [ "$INSTALL_MODE" != "2" ]; then
  INSTALL_MODE=1
fi
echo

AWG_VERSION=2
SUBNET_BASE="10.9.1"
IS_REMOTE=false

if [ "$INSTALL_MODE" = "2" ]; then
  read -p "Публичный IP ЭТОЙ машины (где будет панель): " PANEL_IP
  if [ -z "$PANEL_IP" ]; then
    echo "IP обязателен, прерываю."
    exit 1
  fi

  echo
  echo "--- VPN-сервер за рубежом ---"
  read -p "IP зарубежного сервера (клиенты подключаются к нему, и мы заходим на него по SSH): " SERVER_IP
  if [ -z "$SERVER_IP" ]; then
    echo "IP обязателен, прерываю."
    exit 1
  fi
  SSH_HOST="$SERVER_IP"
  read -p "SSH-пользователь [root]: " SSH_USER
  SSH_USER=${SSH_USER:-root}
  read -p "Порт WireGuard на том сервере [39001]: " WG_PORT
  WG_PORT=${WG_PORT:-39001}
  read -p "Имя Docker-контейнера на том сервере [skdsh-awg]: " CONTAINER_NAME
  CONTAINER_NAME=${CONTAINER_NAME:-skdsh-awg}
  read -p "Название сервера в панели [Основной VPN]: " NAME
  NAME=${NAME:-"Основной VPN"}
  echo
  echo "Версия AmneziaWG:"
  echo "  1) 2.0 — проверенная (по умолчанию)"
  echo "  2) 3.1 — новая, экспериментальная: нужны свежие клиенты (AmneziaVPN 5.0.1.5 и новее)"
  read -p "Выберите [1]: " AWG_CHOICE
  if [ "$AWG_CHOICE" = "2" ]; then
    AWG_VERSION="3.1"
  fi

  echo
  if ! command -v ssh &> /dev/null || ! command -v ssh-keygen &> /dev/null; then
    echo "→ Устанавливаю SSH-клиент…"
    apt install -y openssh-client > /dev/null
  fi
  ssh_prepare_key || exit 1
  ssh_preflight || exit 1
  IS_REMOTE=true
else
read -p "Публичный IP этого сервера: " SERVER_IP
if [ -z "$SERVER_IP" ]; then
  echo "IP обязателен, прерываю."
  exit 1
fi
PANEL_IP="$SERVER_IP"

read -p "Порт WireGuard [39001]: " WG_PORT
WG_PORT=${WG_PORT:-39001}

read -p "Имя Docker-контейнера AmneziaWG [skdsh-awg]: " CONTAINER_NAME
CONTAINER_NAME=${CONTAINER_NAME:-skdsh-awg}

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
  echo "✗ Контейнер \"$CONTAINER_NAME\" уже существует на этом сервере."
  echo "  Если это повторная установка ЭТОЙ ЖЕ панели — можно продолжать (контейнер"
  echo "  будет пересоздан с теми же данными). Если это НОВАЯ, отдельная установка —"
  echo "  выберите другое имя, иначе удалите чужой контейнер молча."
  read -p "Продолжить и пересоздать \"$CONTAINER_NAME\"? [y/N]: " CONFIRM_OVERWRITE
  if [[ ! "$CONFIRM_OVERWRITE" =~ ^[Yy]$ ]]; then
    echo "Прервано. Запустите установку заново с другим именем контейнера."
    exit 1
  fi
fi
fi

read -p "Порт веб-панели [3001]: " WEB_PORT
WEB_PORT=${WEB_PORT:-3001}

read -p "Есть домен для HTTPS? Если да — впишите (например panel.example.com), иначе Enter: " DOMAIN

if [ "$INSTALL_MODE" = "1" ]; then
  read -p "Название сервера в приложении AmneziaVPN [Mr. Skdsh VPN]: " DISPLAY_NAME
  DISPLAY_NAME=${DISPLAY_NAME:-"Mr. Skdsh VPN"}
else
  echo
  echo "Администратор панели (логин и пароль для входа в веб-интерфейс):"
  read -p "Логин: " ADMIN_USERNAME
  ADMIN_USERNAME=$(printf '%s' "$ADMIN_USERNAME" | tr '[:upper:]' '[:lower:]')
  read -sp "Пароль (не короче 6 символов): " ADMIN_PASSWORD
  echo
  if [ -z "$ADMIN_USERNAME" ] || [ "${#ADMIN_PASSWORD}" -lt 6 ]; then
    echo "Логин обязателен, пароль — не короче 6 символов. Прерываю."
    exit 1
  fi
fi

read -p "Настроить Telegram-уведомления о заявках? [y/N]: " SETUP_TG
TELEGRAM_BOT_TOKEN=""
TELEGRAM_ADMIN_CHAT_ID=""
if [[ "$SETUP_TG" =~ ^[Yy]$ ]]; then
  echo "Создайте бота через @BotFather в Telegram (команда /newbot), затем вставьте токен сюда."
  read -p "Токен бота: " TELEGRAM_BOT_TOKEN
  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo "Теперь напишите вашему боту любое сообщение в Telegram (например 'привет'), затем нажмите Enter здесь."
    read -p "Нажмите Enter, когда напишете боту… "

    for attempt in 1 2 3; do
      UPDATES=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" || echo "")
      TELEGRAM_ADMIN_CHAT_ID=$(echo "$UPDATES" | grep -o '"chat":{"id":[0-9-]*' | tail -1 | grep -o '[0-9-]*$' || echo "")
      [ -n "$TELEGRAM_ADMIN_CHAT_ID" ] && break
      sleep 2
    done

    if [ -n "$TELEGRAM_ADMIN_CHAT_ID" ]; then
      echo "✓ chat_id определён автоматически: $TELEGRAM_ADMIN_CHAT_ID"
    else
      echo "⚠ Не удалось определить chat_id автоматически — впишите его в .env вручную позже (узнать можно через @userinfobot)"
    fi
  fi
fi

read -p "Включить защиту регистрации от ботов (Cloudflare Turnstile, бесплатно)? [y/N]: " SETUP_CAPTCHA
TURNSTILE_SITE_KEY=""
TURNSTILE_SECRET_KEY=""
if [[ "$SETUP_CAPTCHA" =~ ^[Yy]$ ]]; then
  echo "Откройте dash.cloudflare.com → Turnstile → Add site, укажите домен панели и скопируйте два ключа."
  read -p "Site key (публичный): " TURNSTILE_SITE_KEY
  read -p "Secret key (секретный): " TURNSTILE_SECRET_KEY
  if [ -z "$TURNSTILE_SITE_KEY" ] || [ -z "$TURNSTILE_SECRET_KEY" ]; then
    echo "⚠ Нужны оба ключа — защита от ботов не включена (можно вписать их в .env позже)"
    TURNSTILE_SITE_KEY=""
    TURNSTILE_SECRET_KEY=""
  fi
fi

if [ "$INSTALL_MODE" = "1" ]; then
  if ! command -v docker &> /dev/null; then
    echo "→ Устанавливаю Docker…"
    curl -fsSL https://get.docker.com | sh
  else
    echo "→ Docker уже установлен, пропускаю"
  fi
else
  echo "→ Docker на этой машине не нужен: VPN-сервер будет на $SERVER_IP"
fi

if ! command -v node &> /dev/null; then
  echo "→ Устанавливаю Node.js…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y nodejs > /dev/null
else
  echo "→ Node.js уже установлен, пропускаю"
fi

if [ "$INSTALL_MODE" = "1" ]; then
echo "→ Разворачиваю AmneziaWG…"
IS_REMOTE=false
AWG_VERSION=2
provision_awg_server
if [ -z "$PROV_PUBLIC_KEY" ]; then
  echo "✗ Не удалось развернуть AmneziaWG-сервер"
  exit 1
fi
echo "✓ AmneziaWG-сервер поднят и работает (интерфейс: $PROV_IFACE_NAME)"

echo "→ Настраиваю форвардинг трафика…"
sysctl -w net.ipv4.ip_forward=1 > /dev/null
grep -q "^net.ipv4.ip_forward" /etc/sysctl.conf 2>/dev/null || \
  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
DEBIAN_FRONTEND=noninteractive apt install -y iptables-persistent > /dev/null 2>&1
echo "✓ NAT и форвардинг настроены"
fi

echo "→ Настраиваю backend…"
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE="false"
PANEL_HOST="0.0.0.0"
[ -n "$DOMAIN" ] && COOKIE_SECURE="true" && PANEL_HOST="127.0.0.1"

# В .env лежат секреты: права только для владельца, до записи содержимого
install -m 600 /dev/null "$SCRIPT_DIR/.env"
cat > "$SCRIPT_DIR/.env" << EOF
PORT=$WEB_PORT
HOST=$PANEL_HOST
JWT_SECRET=$JWT_SECRET
COOKIE_SECURE=$COOKIE_SECURE
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY
TELEGRAM_ADMIN_CHAT_ID=$TELEGRAM_ADMIN_CHAT_ID
EOF

# В режиме 2 VPN-сервер регистрируется в панели через API после запуска, а не из .env
if [ "$INSTALL_MODE" = "1" ]; then
cat >> "$SCRIPT_DIR/.env" << EOF
AWG_CONTAINER=$CONTAINER_NAME
AWG_INTERFACE=$PROV_IFACE_NAME
AWG_CONFIG_PATH=/etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf
SERVER_ENDPOINT=$SERVER_IP:$WG_PORT
SERVER_DISPLAY_NAME=$DISPLAY_NAME
SERVER_PUBLIC_KEY=$PROV_PUBLIC_KEY
SERVER_PRESHARED_KEY=$PROV_PRESHARED_KEY
AWG_JC=$PROV_JC
AWG_JMIN=$PROV_JMIN
AWG_JMAX=$PROV_JMAX
AWG_S1=$PROV_S1
AWG_S2=$PROV_S2
AWG_S3=$PROV_S3
AWG_S4=$PROV_S4
AWG_H1=$PROV_H1
AWG_H2=$PROV_H2
AWG_H3=$PROV_H3
AWG_H4=$PROV_H4
PEER_ADDRESS_START=2
PEER_SUBNET_PREFIX=$SUBNET_BASE.
PEER_SUBNET_MASK=/32
CLIENT_DNS=1.1.1.1
EOF
fi

echo "→ Ставлю зависимости backend (npm install)…"
cd "$SCRIPT_DIR"
npm install > /dev/null

if [ -d "$SCRIPT_DIR/frontend" ]; then
  echo "→ Собираю фронтенд (npm install && npm run build)…"
  cd "$SCRIPT_DIR/frontend"
  npm install > /dev/null
  npm run build > /dev/null
  cd "$SCRIPT_DIR"
  echo "✓ Фронтенд собран"
else
  echo "⚠ Папка frontend не найдена рядом — веб-интерфейс не будет доступен, только API"
fi

echo
if [ "$INSTALL_MODE" = "2" ]; then
  ADMIN_USERNAME="$ADMIN_USERNAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" node src/create-admin.js
else
  echo "=== Создание администратора ==="
  node src/create-admin.js
fi

SERVICE_NAME="skdsh-panel-$(basename "$SCRIPT_DIR")"
echo "→ Настраиваю systemd-сервис ($SERVICE_NAME)…"

if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
  EXISTING_DIR=$(grep "^WorkingDirectory=" "/etc/systemd/system/${SERVICE_NAME}.service" | cut -d= -f2)
  if [ -n "$EXISTING_DIR" ] && [ "$EXISTING_DIR" != "$SCRIPT_DIR" ]; then
    echo "✗ Сервис $SERVICE_NAME уже существует и указывает на другую папку ($EXISTING_DIR)."
    echo "  Переименуйте папку установки или удалите старый сервис вручную, прежде чем продолжать."
    exit 1
  fi
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=Mr. Skdsh VPN ($SCRIPT_DIR)
After=network.target docker.service

[Service]
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node src/server.js
Restart=always
EnvironmentFile=$SCRIPT_DIR/.env
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME" > /dev/null

sleep 1
if curl -sf http://localhost:$WEB_PORT/api/health > /dev/null; then
  echo "✓ Панель запущена и отвечает"
else
  echo "✗ Панель не отвечает, проверьте: systemctl status $SERVICE_NAME"
  exit 1
fi

if [ -n "$DOMAIN" ]; then
  echo "→ Настраиваю HTTPS через Caddy для $DOMAIN…"
  if ! command -v caddy &> /dev/null; then
    apt install -y debian-keyring debian-archive-keyring apt-transport-https curl > /dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt update > /dev/null && apt install -y caddy > /dev/null
  fi

  cat > /etc/caddy/Caddyfile << EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:$WEB_PORT
}
EOF
  systemctl restart caddy
  echo "✓ Caddy настроен — убедитесь, что A-запись $DOMAIN указывает на $PANEL_IP"
fi

if [ "$INSTALL_MODE" = "2" ]; then
  echo
  echo "→ Разворачиваю AmneziaWG на зарубежном сервере ($SERVER_IP), это может занять пару минут…"
  IS_REMOTE=true
  PANEL_URL="http://localhost:$WEB_PORT"
  if provision_awg_server && register_server_via_api; then
    echo "✓ Зарубежный VPN-сервер подключён к панели"
  else
    echo "⚠ Панель установлена, но зарубежный сервер не подключился."
    echo "  Повторить можно позже: sudo ./add-server.sh (выберите «ssh»)"
  fi
  unset ADMIN_PASSWORD
fi

echo
echo "=== Готово ==="
if [ -n "$DOMAIN" ]; then
  echo "Панель: https://$DOMAIN"
else
  echo "Панель: http://$PANEL_IP:$WEB_PORT (без HTTPS — рекомендуется SSH-туннель для доступа)"
  echo "  ssh -L $WEB_PORT:localhost:$WEB_PORT root@$PANEL_IP"
  echo "  затем откройте http://localhost:$WEB_PORT"
fi
echo
if [ "$INSTALL_MODE" = "2" ]; then
  echo "Порты:"
  echo "  на зарубежном сервере: $WG_PORT/udp — для клиентов (у хостера может быть свой firewall)"
  [ -n "$DOMAIN" ] && echo "  на этой машине: 80 и 443 — для панели"
  [ -z "$DOMAIN" ] && echo "  на этой машине наружу ничего открывать не нужно — только SSH-туннель"
  echo "  Панель ходит на зарубежный сервер по SSH (порт 22), ключ: $SSH_KEY"
else
  echo "Не забудьте открыть порты в firewall, если он активен:"
  echo "  ufw allow $WG_PORT/udp"
  [ -n "$DOMAIN" ] && echo "  ufw allow 80" && echo "  ufw allow 443"
  [ -z "$DOMAIN" ] && echo "  (порт $WEB_PORT наружу открывать не обязательно — только для SSH-туннеля)"
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_ADMIN_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$TELEGRAM_ADMIN_CHAT_ID\", \"text\": \"✅ Mr. Skdsh VPN: Telegram-уведомления настроены и работают\"}" \
    > /dev/null
  echo
  echo "Проверьте Telegram — должно прийти тестовое сообщение от бота."
fi

echo
read -p "Развернуть ещё один AmneziaWG-сервер прямо сейчас? [y/N]: " ADD_MORE
EXTRA_SUBNET_COUNTER=20
while [[ "$ADD_MORE" =~ ^[Yy]$ ]]; do
  echo
  SUBNET_BASE="10.$EXTRA_SUBNET_COUNTER.1"
  EXTRA_SUBNET_COUNTER=$((EXTRA_SUBNET_COUNTER + 1))

  read -p "Разворачивать здесь или на другом сервере по SSH? [здесь/ssh]: " WHERE
  IS_REMOTE=false
  if [[ "$WHERE" =~ ^[Ss][Ss][Hh]$ ]]; then
    IS_REMOTE=true
    read -p "IP удалённого сервера: " SSH_HOST
    read -p "SSH-пользователь [root]: " SSH_USER
    SSH_USER=${SSH_USER:-root}
    if ! command -v ssh &> /dev/null; then
      apt install -y openssh-client > /dev/null
    fi
    if ! { ssh_prepare_key && ssh_preflight; }; then
      echo "Пропускаю этот сервер."
      read -p "Развернуть ещё один? [y/N]: " ADD_MORE
      continue
    fi
  fi

  read -p "Название для панели: " NAME
  read -p "Публичный IP сервера, который увидят клиенты: " SERVER_IP
  read -p "Порт WireGuard (не должен совпадать с уже занятыми): " WG_PORT
  read -p "Имя для Docker-контейнера: " CONTAINER_NAME
  echo
  echo "Версия AmneziaWG:"
  echo "  1) 2.0 — проверенная (по умолчанию)"
  echo "  2) 3.1 — новая, экспериментальная: нужны свежие клиенты (AmneziaVPN 5.0.1.5 и новее)"
  read -p "Выберите [1]: " AWG_CHOICE
  if [ "$AWG_CHOICE" = "2" ]; then
    AWG_VERSION="3.1"
  else
    AWG_VERSION="2"
  fi

  echo "→ Разворачиваю…"
  if provision_awg_server; then
    echo "✓ Поднят, интерфейс: $PROV_IFACE_NAME"

    REGISTERED=false
    read -p "Зарегистрировать в панели прямо сейчас через API? [Y/n]: " AUTO_REG
    if [[ ! "$AUTO_REG" =~ ^[Nn]$ ]]; then
      PANEL_URL="http://localhost:$WEB_PORT"
      read -p "Логин администратора панели: " ADMIN_USERNAME
      read -sp "Пароль администратора: " ADMIN_PASSWORD
      echo
      if register_server_via_api; then
        REGISTERED=true
      fi
    fi

    if [ "$REGISTERED" = false ]; then
      echo
      echo "Добавьте сервер вручную через раздел 'Серверы' → '+ Добавить сервер':"
      echo
      echo "Название:        $NAME"
      echo "Адрес:порт:      $SERVER_IP:$WG_PORT"
      echo "Контейнер:       $CONTAINER_NAME"
      echo "Имя интерфейса:  $PROV_IFACE_NAME"
      echo "Версия AmneziaWG: $AWG_VERSION"
      echo "Путь к конфигу:  /etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf"
      echo "Публичный ключ:  $PROV_PUBLIC_KEY"
      echo "Preshared key:   $PROV_PRESHARED_KEY"
      echo "Префикс подсети: $SUBNET_BASE."
      echo "Jc / Jmin / Jmax: $PROV_JC / $PROV_JMIN / $PROV_JMAX"
      echo "S1-S4: $PROV_S1 / $PROV_S2 / $PROV_S3 / $PROV_S4"
      echo "H1: $PROV_H1"
      echo "H2: $PROV_H2"
      echo "H3: $PROV_H3"
      echo "H4: $PROV_H4"
      if [ "$AWG_VERSION" = "3.1" ]; then
        echo "HeaderProtectionKey: $PROV_HPK"
        echo "ContentPaddingAddition: 0-64, RandomTrailers: on, DisableCookies: off"
      fi
      if [ "$IS_REMOTE" = true ]; then
        echo "Вкладка 'Удалённый (по SSH)': IP=$SSH_HOST, юзер=$SSH_USER, ключ=$SSH_KEY"
      fi
    fi
  fi

  echo
  read -p "Развернуть ещё один? [y/N]: " ADD_MORE
done
