#!/bin/bash
# Запуск всех автотестов панели на поддельных docker/ss/ufw (настоящий VPS не нужен) и настоящем Xray.
# Нужны: bash, node, python3, openssl, curl. Запуск: tests/run-all.sh [имя-набора ...]
# Тесты создают временные файлы в /opt/skdsh-panel/xray-* и /tmp, поэтому запускайте на тестовой машине, не на боевой.
set -u
export ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$ROOT/tests"
export XRAY_BIN="${XRAY_BIN:-/tmp/xr/xray}"
SP="${TEST_WORK:-/tmp/skdsh-tests}"
rm -rf "$SP"; mkdir -p "$SP"
cp -r "$T/shims/"* "$SP/"
chmod +x "$SP"/*/bin/* "$T"/*.sh

if [ ! -x "$XRAY_BIN" ]; then
  echo "Скачиваю Xray 26.3.27 для тестов в $XRAY_BIN…"
  mkdir -p "$(dirname "$XRAY_BIN")"
  case "$(uname -m)" in aarch64|arm64) A=arm64-v8a ;; *) A=64 ;; esac
  U="https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-linux-$A.zip"
  curl -fsSL "$U" -o "$SP/x.zip" && curl -fsSL "$U.dgst" -o "$SP/x.dgst" || { echo "Не удалось скачать Xray"; exit 1; }
  SUM=$(grep '^SHA2-256=' "$SP/x.dgst" | awk '{print $2}')
  echo "$SUM  $SP/x.zip" | sha256sum -c - >/dev/null || { echo "Контрольная сумма Xray не совпала"; exit 1; }
  unzip -o -q "$SP/x.zip" xray -d "$(dirname "$XRAY_BIN")" && chmod +x "$XRAY_BIN"
fi

SUITES=(
  "awg-provision|test-provision.sh $SP"
  "xray-provision|test-xray-prov.sh $SP"
  "xray-adapter|test-xray-adapter.sh $SP"
  "xray-limits|test-xray-limits.sh $SP"
  "hysteria2-provision|test-hy2-prov.sh $SP"
  "hysteria2-adapter|test-hy2-adapter.sh $SP"
  "shadowsocks-adapter|test-ss-adapter.sh $SP"
  "port-pick|test-portpick.sh $SP"
  "api-awg-2.0-3.1|api.sh $SP test-api31.py 3104 fake2 register-both"
  "api-awg-2.0-3.1-b|api.sh $SP test-api31b.py 3104 fake2 register-both"
  "api-awg-2.0-3.1-c|api.sh $SP test-api31c.py 3104 fake2 register-both"
  "api-awg-2.0-3.1-d|api.sh $SP test-api31d.py 3104 fake2 register-both"
  "api-xray|api.sh $SP test-xray-api.py 3191 fake3"
  "api-hysteria2|api.sh $SP test-hy2-api.py 3193 fake3"
  "api-shadowsocks|api.sh $SP test-ss-api.py 3193 fake3"
)
[ -f "$T/test-security.sh" ] && SUITES+=("security|test-security.sh $SP")
[ -f "$T/test-upgrade.sh" ] && SUITES+=("upgrade-old-db|test-upgrade.sh $SP")

passed=0; failed=0; : > "$SP/report.txt"
for entry in "${SUITES[@]}"; do
  name="${entry%%|*}"; cmd="${entry#*|}"
  if [ $# -gt 0 ] && [[ " $* " != *" $name "* ]]; then continue; fi
  out="$SP/$name.out"
  timeout 280 bash "$T/${cmd%% *}" ${cmd#* } > "$out" 2>&1; rc=$?
  summary=$(grep -E "ИТОГ" "$out" | tail -1)
  if [ $rc -eq 0 ] && ! grep -qE "^(FAIL|✗ FAIL)" "$out" && ! echo "$summary" | grep -qE "провалов [1-9]|ЕСТЬ"; then
    echo "PASS  $name  ${summary:-(код 0)}"; passed=$((passed+1)); echo "PASS $name $summary" >> "$SP/report.txt"
  else
    echo "FAIL  $name  (код $rc, подробности: $out)"; failed=$((failed+1)); echo "FAIL $name rc=$rc $summary" >> "$SP/report.txt"
    grep -E "^FAIL" "$out" | head -5
  fi
done
echo "ИТОГО: прошло наборов $passed, упало $failed"
[ $failed -eq 0 ]
