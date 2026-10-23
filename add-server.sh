#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/provision-awg.sh"

SUBNET_BASE="10.20.1"

echo "=== Добавление AmneziaWG-сервера ==="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Запустите с sudo: sudo ./add-server.sh"
  exit 1
fi

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
  ssh_prepare_key || exit 1
  echo "Проверяю SSH-доступ…"
  ssh_preflight || exit 1
fi

read -p "Название для панели (например 'Сервер NL-2'): " NAME
read -p "Публичный IP сервера, который увидят клиенты: " SERVER_IP
read -p "Порт WireGuard (не должен совпадать с уже занятыми на том хосте): " WG_PORT
read -p "Имя для Docker-контейнера (например skdsh-awg-2): " CONTAINER_NAME
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

echo
echo "→ Разворачиваю AmneziaWG…"
provision_awg_server

echo
echo "=== Сервер поднят ==="
echo "Название:        $NAME"
echo "Адрес:порт:      $SERVER_IP:$WG_PORT"
echo "Контейнер:       $CONTAINER_NAME"
echo "Имя интерфейса:  $PROV_IFACE_NAME"
echo "Версия AmneziaWG: $AWG_VERSION"
echo "Публичный ключ:  $PROV_PUBLIC_KEY"

echo
read -p "Зарегистрировать этот сервер в панели прямо сейчас через API? [Y/n]: " AUTO_REGISTER
if [[ ! "$AUTO_REGISTER" =~ ^[Nn]$ ]]; then
  read -p "Адрес панели (например http://localhost:3001 или https://ваш-домен.ru): " PANEL_URL
  read -p "Логин администратора панели: " ADMIN_USERNAME
  read -sp "Пароль администратора: " ADMIN_PASSWORD
  echo

  if register_server_via_api; then
    echo
    echo "Готово — сервер уже виден в разделе 'Серверы' панели."
    exit 0
  fi
  echo "Не получилось зарегистрировать автоматически — данные для ручного добавления ниже."
fi

echo
echo "Добавьте сервер вручную через раздел 'Серверы' → '+ Добавить сервер':"
echo
echo "Путь к конфигу:  /etc/amnezia/amneziawg/$PROV_IFACE_NAME.conf"
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
  echo
  echo "Вкладка 'Удалённый (по SSH)':"
  echo "  IP:      $SSH_HOST"
  echo "  Юзер:    $SSH_USER"
  echo "  Ключ:    $SSH_KEY"
fi
echo
echo "Не забудьте открыть порт в firewall на том сервере: ufw allow $WG_PORT/udp"
