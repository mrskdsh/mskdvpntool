AWG2_IMAGE="vernette/amneziawg:v1.0.20260223"
AWG31_IMAGE="vernette/amneziawg:v3.1.20260812"

# Общие настройки SSH. accept-new: запоминает отпечаток при первом подключении,
# но не даёт молча подменить сервер при следующих (в отличие от StrictHostKeyChecking=no).
SSH_BASE_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=15)

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Проверяет вход по ключу $SSH_KEY на $SSH_USER@$SSH_HOST (без вопросов и паролей).
ssh_test_key() {
  ssh -n "${SSH_BASE_OPTS[@]}" -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" \
    "$SSH_USER@$SSH_HOST" "echo ok" > /dev/null 2>&1
}

# Спрашивает, какой ключ использовать, и при необходимости создаёт отдельный ключ для панели
# и устанавливает его на удалённый сервер. Результат — переменная SSH_KEY.
ssh_prepare_key() {
  echo "SSH-доступ к $SSH_USER@$SSH_HOST:"
  echo "  1) Создать отдельный ключ для панели и установить его на сервер (нужен пароль сервера, один раз) — рекомендуется"
  echo "  2) У меня уже есть ключ с доступом к этому серверу"
  read -p "Выберите [1]: " KEY_CHOICE
  if [ "$KEY_CHOICE" = "2" ]; then
    read -p "Путь к приватному ключу (на ЭТОЙ машине): " SSH_KEY
    return 0
  fi

  SSH_KEY="/root/.ssh/skdsh_$(printf '%s' "$SSH_HOST" | tr -c 'a-zA-Z0-9' '_')"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  if [ ! -f "$SSH_KEY" ]; then
    ssh-keygen -q -t ed25519 -N "" -C "mr-skdsh-vpn-panel" -f "$SSH_KEY"
  fi
  local pub blob
  pub=$(cat "$SSH_KEY.pub")
  blob=$(printf '%s' "$pub" | awk '{print $2}')
  echo "Сейчас ssh один раз попросит пароль от $SSH_USER@$SSH_HOST…"
  ssh -n "${SSH_BASE_OPTS[@]}" "$SSH_USER@$SSH_HOST" \
    "umask 077; mkdir -p ~/.ssh; grep -qF '$blob' ~/.ssh/authorized_keys 2>/dev/null || echo 'no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $pub' >> ~/.ssh/authorized_keys" || {
    echo "✗ Не удалось установить ключ на сервер (неверный пароль или вход по паролю отключён)."
    return 1
  }
  echo "✓ Ключ установлен: $SSH_KEY"
}

# Проверяет, что к удалённому серверу можно подключиться по ключу и что там хватает прав.
ssh_preflight() {
  if ! ssh_test_key; then
    echo "✗ Не удалось войти по SSH-ключу. Проверьте IP, пользователя и ключ."
    return 1
  fi
  if [ "$SSH_USER" != "root" ]; then
    if ! ssh -n "${SSH_BASE_OPTS[@]}" -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" \
      "$SSH_USER@$SSH_HOST" "sudo -n true" > /dev/null 2>&1; then
      echo "✗ У пользователя $SSH_USER нет sudo без пароля. Используйте root или настройте NOPASSWD."
      return 1
    fi
  fi
  if [ "$(ssh -n "${SSH_BASE_OPTS[@]}" -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" \
    "$SSH_USER@$SSH_HOST" "uname -s" 2>/dev/null)" != "Linux" ]; then
    echo "✗ Удалённый сервер должен быть на Linux."
    return 1
  fi
  echo "✓ SSH-доступ подтверждён"
}

provision_awg_server() {
  AWG_VERSION="${AWG_VERSION:-2}"
  local image="$AWG2_IMAGE"
  if [ "$AWG_VERSION" = "3.1" ]; then
    image="$AWG31_IMAGE"
  fi

  local script
  script=$(cat << PROVISION_EOF
set -e
IMAGE="$image"
AWG_VERSION="$AWG_VERSION"
CONTAINER_NAME="$CONTAINER_NAME"
WG_PORT="$WG_PORT"
SUBNET_BASE="$SUBNET_BASE"

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
fi
docker pull "\$IMAGE" > /dev/null

PRIVATE_KEY=\$(docker run --rm --entrypoint awg "\$IMAGE" genkey)
PUBLIC_KEY=\$(echo "\$PRIVATE_KEY" | docker run --rm -i --entrypoint awg "\$IMAGE" pubkey)
PRESHARED_KEY=\$(docker run --rm --entrypoint awg "\$IMAGE" genpsk)

PARAMS=\$(docker run --rm --entrypoint awg-genparams "\$IMAGE")
CLIENT_JC=\$(echo "\$PARAMS" | grep "^Jc" | awk -F'= ' '{print \$2}')
CLIENT_JMIN=\$(echo "\$PARAMS" | grep "^Jmin" | awk -F'= ' '{print \$2}')
CLIENT_JMAX=\$(echo "\$PARAMS" | grep "^Jmax" | awk -F'= ' '{print \$2}')
S1=\$(echo "\$PARAMS" | grep "^S1" | head -1 | awk -F'= ' '{print \$2}')
S2=\$(echo "\$PARAMS" | grep "^S2" | head -1 | awk -F'= ' '{print \$2}')
S3=\$(echo "\$PARAMS" | grep "^S3" | head -1 | awk -F'= ' '{print \$2}')
S4=\$(echo "\$PARAMS" | grep "^S4" | head -1 | awk -F'= ' '{print \$2}')
H1=\$(echo "\$PARAMS" | grep "^H1" | head -1 | awk -F'= ' '{print \$2}')
H2=\$(echo "\$PARAMS" | grep "^H2" | head -1 | awk -F'= ' '{print \$2}')
H3=\$(echo "\$PARAMS" | grep "^H3" | head -1 | awk -F'= ' '{print \$2}')
H4=\$(echo "\$PARAMS" | grep "^H4" | head -1 | awk -F'= ' '{print \$2}')

HPK=""
EXTRA_LINES=""
if [ "\$AWG_VERSION" = "3.1" ]; then
  randint() {
    lo=\$1
    hi=\$2
    rand=\$(od -An -tu4 -N4 /dev/urandom | tr -d ' ')
    echo \$((lo + rand % (hi - lo + 1)))
  }
  if [ "\$S3" -lt 12 ]; then
    S3=\$(randint 12 64)
    while [ "\$S3" -eq "\$S1" ] || [ "\$S3" -eq "\$S2" ] || [ "\$S3" -eq "\$S4" ] ||
      [ \$((S1 + 148)) -eq \$((S3 + 64)) ] || [ \$((S2 + 92)) -eq \$((S3 + 64)) ]; do
      S3=\$(randint 12 64)
    done
  fi
  if [ "\$S4" -lt 12 ]; then
    S4=\$(randint 12 20)
    while [ "\$S4" -eq "\$S1" ] || [ "\$S4" -eq "\$S2" ] || [ "\$S4" -eq "\$S3" ]; do
      S4=\$(randint 12 20)
    done
  fi
  HPK=\$(docker run --rm --entrypoint awg "\$IMAGE" genkey)
  EXTRA_LINES=\$(printf 'HeaderProtectionKey = %s\nRandomTrailers = on\nContentPaddingAddition = 0-64' "\$HPK")
fi

IFACE_NAME=\$(printf '%s' "\$CONTAINER_NAME" | tr -c 'a-zA-Z0-9' '-' | cut -c1-15)
CONFIG_DIR="/opt/skdsh-panel/configs-\$CONTAINER_NAME"
mkdir -p "\$CONFIG_DIR"
cat > "\$CONFIG_DIR/\$IFACE_NAME.conf" << CONF_EOF
[Interface]
PrivateKey = \$PRIVATE_KEY
Address = $SUBNET_BASE.1/24
ListenPort = $WG_PORT
S1 = \$S1
S2 = \$S2
S3 = \$S3
S4 = \$S4
H1 = \$H1
H2 = \$H2
H3 = \$H3
H4 = \$H4
CONF_EOF
if [ -n "\$EXTRA_LINES" ]; then
  printf '%s\n' "\$EXTRA_LINES" >> "\$CONFIG_DIR/\$IFACE_NAME.conf"
fi

docker rm -f "\$CONTAINER_NAME" > /dev/null 2>&1 || true
docker run -d \
  --name "\$CONTAINER_NAME" \
  -v "\$CONFIG_DIR:/etc/amnezia/amneziawg" \
  --network host \
  --device=/dev/net/tun:/dev/net/tun \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_MODULE \
  --restart always \
  "\$IMAGE" > /dev/null

sleep 2
if ! docker exec "\$CONTAINER_NAME" awg show "\$IFACE_NAME" > /dev/null 2>&1; then
  echo "ERROR: интерфейс не поднялся"
  exit 1
fi

MAIN_IFACE=\$(ip route show default | awk '{print \$5; exit}')
iptables -t nat -C POSTROUTING -s "$SUBNET_BASE.0/24" -o "\$MAIN_IFACE" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s "$SUBNET_BASE.0/24" -o "\$MAIN_IFACE" -j MASQUERADE
iptables -C FORWARD -i "\$IFACE_NAME" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i "\$IFACE_NAME" -j ACCEPT
iptables -C FORWARD -o "\$IFACE_NAME" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -o "\$IFACE_NAME" -j ACCEPT
if command -v netfilter-persistent &> /dev/null; then
  netfilter-persistent save > /dev/null 2>&1 || true
fi

# Пересылка пакетов нужна на любом VPN-сервере, в том числе удалённом
sysctl -w net.ipv4.ip_forward=1 > /dev/null 2>&1 || true
mkdir -p /etc/sysctl.d
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-skdsh-forward.conf

FIREWALL="none"
if command -v ufw > /dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  if ufw allow "$WG_PORT/udp" > /dev/null 2>&1; then
    FIREWALL="ufw-opened"
  fi
fi

PORT_LISTENING="unknown"
if command -v ss > /dev/null 2>&1; then
  if ss -lun 2>/dev/null | awk '{print \$4}' | grep -q ":$WG_PORT\$"; then
    PORT_LISTENING="yes"
  else
    PORT_LISTENING="no"
  fi
fi

echo "RESULT_START"
echo "PUBLIC_KEY=\$PUBLIC_KEY"
echo "PRESHARED_KEY=\$PRESHARED_KEY"
echo "IFACE_NAME=\$IFACE_NAME"
echo "JC=\$CLIENT_JC"
echo "JMIN=\$CLIENT_JMIN"
echo "JMAX=\$CLIENT_JMAX"
echo "S1=\$S1"
echo "S2=\$S2"
echo "S3=\$S3"
echo "S4=\$S4"
echo "H1=\$H1"
echo "H2=\$H2"
echo "H3=\$H3"
echo "H4=\$H4"
echo "AWG_VERSION=\$AWG_VERSION"
echo "HEADER_PROTECTION_KEY=\$HPK"
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
  PROV_PRESHARED_KEY=$(get_val PRESHARED_KEY)
  PROV_IFACE_NAME=$(get_val IFACE_NAME)
  PROV_JC=$(get_val JC)
  PROV_JMIN=$(get_val JMIN)
  PROV_JMAX=$(get_val JMAX)
  PROV_S1=$(get_val S1); PROV_S2=$(get_val S2); PROV_S3=$(get_val S3); PROV_S4=$(get_val S4)
  PROV_H1=$(get_val H1); PROV_H2=$(get_val H2); PROV_H3=$(get_val H3); PROV_H4=$(get_val H4)
  PROV_HPK=$(get_val HEADER_PROTECTION_KEY)
  PROV_FIREWALL=$(get_val FIREWALL)
  PROV_PORT_LISTENING=$(get_val PORT_LISTENING)

  if [ "$PROV_FIREWALL" = "ufw-opened" ]; then
    echo "✓ Порт $WG_PORT/udp открыт в ufw на сервере"
  else
    echo "⚠ Откройте порт $WG_PORT/udp в firewall сервера и в панели хостинга (если у хостера есть свой firewall)"
  fi
  if [ "$PROV_PORT_LISTENING" = "no" ]; then
    echo "⚠ На сервере ничего не слушает UDP-порт $WG_PORT — проверьте: docker logs $CONTAINER_NAME"
  fi
}

register_server_via_api() {
  local cookie_jar
  cookie_jar=$(mktemp)

  curl -s -c "$cookie_jar" -X POST "$PANEL_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$(json_escape "$ADMIN_USERNAME")\",\"password\":\"$(json_escape "$ADMIN_PASSWORD")\"}" > /tmp/login_response.json

  if ! grep -q '"user"' /tmp/login_response.json; then
    echo "✗ Не удалось войти в панель — проверьте адрес/логин/пароль:"
    cat /tmp/login_response.json
    rm -f "$cookie_jar" /tmp/login_response.json
    return 1
  fi

  local ssh_fields=""
  if [ "$IS_REMOTE" = true ]; then
    ssh_fields=", \"sshHost\": \"$SSH_HOST\", \"sshUser\": \"$SSH_USER\", \"sshKeyPath\": \"$SSH_KEY\""
  fi

  local awg_fields=", \"awgVersion\": \"${AWG_VERSION:-2}\""
  if [ "${AWG_VERSION:-2}" = "3.1" ]; then
    awg_fields="$awg_fields, \"extraParams\": {\"headerProtectionKey\": \"$PROV_HPK\", \"contentPaddingAddition\": \"0-64\", \"randomTrailers\": \"on\", \"disableCookies\": \"off\"}"
  fi

  local response
  response=$(curl -s -b "$cookie_jar" -X POST "$PANEL_URL/api/servers" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$(json_escape "$NAME")\",
      \"endpoint\": \"$SERVER_IP:$WG_PORT\",
      \"container\": \"$CONTAINER_NAME\",
      \"interface\": \"$PROV_IFACE_NAME\",
      \"configPath\": \"/etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf\",
      \"publicKey\": \"$PROV_PUBLIC_KEY\",
      \"presharedKey\": \"$PROV_PRESHARED_KEY\",
      \"subnetPrefix\": \"$SUBNET_BASE.\",
      \"jc\": \"$PROV_JC\", \"jmin\": \"$PROV_JMIN\", \"jmax\": \"$PROV_JMAX\",
      \"s1\": \"$PROV_S1\", \"s2\": \"$PROV_S2\", \"s3\": \"$PROV_S3\", \"s4\": \"$PROV_S4\",
      \"h1\": \"$PROV_H1\", \"h2\": \"$PROV_H2\", \"h3\": \"$PROV_H3\", \"h4\": \"$PROV_H4\"
      $ssh_fields
      $awg_fields
    }")

  rm -f "$cookie_jar" /tmp/login_response.json

  if echo "$response" | grep -q '"id"'; then
    echo "✓ Сервер автоматически зарегистрирован в панели"
    return 0
  else
    echo "✗ Не удалось зарегистрировать сервер через API:"
    echo "$response"
    return 1
  fi
}
