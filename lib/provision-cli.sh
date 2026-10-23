#!/bin/bash
# Неинтерактивный запуск развёртывания сервера — его вызывает панель (src/provisionJobs.js).
# Все параметры приходят через окружение и уже проверены в Node. Скрипт ничего не спрашивает.
#
# Общие: PROTOCOL (awg — по умолчанию, vless-reality, hysteria2 или shadowsocks), CONTAINER_NAME, IS_REMOTE (true/false)
# Для удалённого сервера: SSH_HOST, SSH_USER, SSH_KEY
# AmneziaWG:  AWG_VERSION, WG_PORT, SUBNET_BASE
# VLESS+REALITY, Hysteria2 и Shadowsocks: XRAY_PORT, XRAY_API_PORT, XRAY_SNI
set -e

source "$(dirname "$0")/provision-awg.sh"
PROTOCOL="${PROTOCOL:-awg}"

echo "STAGE Проверяю доступ к серверу"
if [ "$IS_REMOTE" = "true" ]; then
  ssh_preflight || exit 1
fi

if [ "$PROTOCOL" = "vless-reality" ] || [ "$PROTOCOL" = "hysteria2" ] || [ "$PROTOCOL" = "shadowsocks" ]; then
  source "$(dirname "$0")/provision-xray.sh"
  if [ "$PROTOCOL" = "hysteria2" ]; then
    XRAY_MODE=hysteria2
    echo "STAGE Разворачиваю Xray (Hysteria2): скачивание может занять минуту"
  elif [ "$PROTOCOL" = "shadowsocks" ]; then
    XRAY_MODE=shadowsocks
    echo "STAGE Разворачиваю Xray (Shadowsocks-2022): скачивание может занять минуту"
  else
    XRAY_MODE=reality
    echo "STAGE Разворачиваю Xray (VLESS + REALITY): скачивание может занять минуту"
  fi
  provision_xray_server || exit 1
  # Результат для панели: по строке KEY=значение
  echo "PANEL_RESULT PUBLIC_KEY=$PROV_PUBLIC_KEY"
  echo "PANEL_RESULT PIN_SHA256=$PROV_PIN_SHA256"
  echo "PANEL_RESULT SHORT_ID=$PROV_SHORT_ID"
  echo "PANEL_RESULT SNI=$PROV_SNI"
  echo "PANEL_RESULT PORT=$PROV_PORT"
  echo "PANEL_RESULT API_PORT=$PROV_API_PORT"
  exit 0
fi

echo "STAGE Разворачиваю AmneziaWG (скачивание образа может занять несколько минут)"
provision_awg_server || exit 1

# Результат для панели: по строке KEY=значение (значения — base64, числа и диапазоны, без пробелов)
echo "PANEL_RESULT PUBLIC_KEY=$PROV_PUBLIC_KEY"
echo "PANEL_RESULT PRESHARED_KEY=$PROV_PRESHARED_KEY"
echo "PANEL_RESULT IFACE_NAME=$PROV_IFACE_NAME"
echo "PANEL_RESULT JC=$PROV_JC"
echo "PANEL_RESULT JMIN=$PROV_JMIN"
echo "PANEL_RESULT JMAX=$PROV_JMAX"
echo "PANEL_RESULT S1=$PROV_S1"
echo "PANEL_RESULT S2=$PROV_S2"
echo "PANEL_RESULT S3=$PROV_S3"
echo "PANEL_RESULT S4=$PROV_S4"
echo "PANEL_RESULT H1=$PROV_H1"
echo "PANEL_RESULT H2=$PROV_H2"
echo "PANEL_RESULT H3=$PROV_H3"
echo "PANEL_RESULT H4=$PROV_H4"
echo "PANEL_RESULT HPK=$PROV_HPK"
