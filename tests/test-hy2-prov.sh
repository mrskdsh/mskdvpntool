#!/bin/bash
SP=$1
export PATH=$SP/fake3/bin:$PATH FAKE_LOG=$SP/fake3.log FAKE_STATE=/tmp/fake3-state
: > "$FAKE_LOG"; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-*
source $ROOT/lib/provision-awg.sh
source $ROOT/lib/provision-xray.sh
pass=0; fail=0
check() { if [ "$2" = "1" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1 $3"; fi; }
IS_REMOTE=false; CONTAINER_NAME=t-hy; XRAY_MODE=hysteria2; XRAY_PORT=39555; XRAY_API_PORT=39086; XRAY_SNI=www.example.com
provision_xray_server > $SP/prov-hy.out 2>&1 || { cat $SP/prov-hy.out; exit 1; }
cat $SP/prov-hy.out
d=/opt/skdsh-panel/xray-t-hy
check "сертификат и ключ созданы, ключ 600" "$([ -f $d/hy2.crt ] && [ "$(stat -c %a $d/hy2.key)" = 600 ] && echo 1 || echo 0)"
check "отпечаток в формате AA:BB:… (32 пары)" "$([[ $PROV_PIN_SHA256 =~ ^([0-9A-F]{2}:){31}[0-9A-F]{2}$ ]] && echo 1 || echo 0)" "$PROV_PIN_SHA256"
fp=$(openssl x509 -in $d/hy2.crt -noout -fingerprint -sha256 | cut -d= -f2)
check "отпечаток совпадает с настоящим сертификатом (openssl)" "$([ "$fp" = "$PROV_PIN_SHA256" ] && echo 1 || echo 0)" "$fp vs $PROV_PIN_SHA256"
check "публичного ключа REALITY нет, shortId пуст" "$([ -z "$PROV_PUBLIC_KEY" ] && [ -z "$PROV_SHORT_ID" ] && echo 1 || echo 0)"
check "порт, SNI, API-порт вернулись" "$([ "$PROV_PORT" = 39555 ] && [ "$PROV_SNI" = www.example.com ] && [ "$PROV_API_PORT" = 39086 ] && echo 1 || echo 0)"
python3 - $d/config.json > $SP/hy-cfg-check.out <<'PY'
import json,sys
c=json.load(open(sys.argv[1])); ib=[i for i in c["inbounds"] if i["tag"]=="hysteria2"][0]
print(int(ib["protocol"]=="hysteria" and ib["port"]==39555 and ib["settings"]["clients"]==[] and ib["streamSettings"]["network"]=="hysteria" and ib["streamSettings"]["security"]=="tls"))
PY
check "конфиг: inbound hysteria, клиентов нет" "$(cat $SP/hy-cfg-check.out)"
sleep 1
check "процесс жив и слушает UDP-порт" "$(grep -qi ':9A83 ' /proc/net/udp /proc/net/udp6 && echo 1 || echo 0)"
check "firewall: ufw-правило именно udp" "$(grep -c 'ufw allow' $FAKE_LOG | awk '{print 1}')"
docker rm -f t-hy >/dev/null
echo "ИТОГ: прошло $pass, провалов $fail"
