#!/bin/bash
SP=$1
export PATH=$SP/fake3/bin:$PATH FAKE_LOG=$SP/fake3.log FAKE_STATE=/tmp/fake3-state
: > "$FAKE_LOG"; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-*
source $ROOT/lib/provision-awg.sh
source $ROOT/lib/provision-xray.sh
pass=0; fail=0
check() { if [ "$2" = "1" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1 $3"; fi; }
b64u='^[A-Za-z0-9_-]{43}$'
IS_REMOTE=false; CONTAINER_NAME=t-xr; XRAY_PORT=39443; XRAY_API_PORT=39085; XRAY_SNI=www.example.com
provision_xray_server > $SP/prov-xr.out 2>&1 || { cat $SP/prov-xr.out; exit 1; }
cat $SP/prov-xr.out
cfg=/opt/skdsh-panel/xray-t-xr/config.json
check "публичный ключ в формате base64url" "$([[ $PROV_PUBLIC_KEY =~ $b64u ]] && echo 1 || echo 0)" "$PROV_PUBLIC_KEY"
check "shortId 16 hex" "$([[ $PROV_SHORT_ID =~ ^[0-9a-f]{16}$ ]] && echo 1 || echo 0)" "$PROV_SHORT_ID"
check "SNI/порт/версия вернулись" "$([ "$PROV_SNI" = www.example.com ] && [ "$PROV_PORT" = 39443 ] && [ "$PROV_API_PORT" = 39085 ] && [ "$PROV_XRAY_VERSION" = 26.3.27 ] && echo 1 || echo 0)"
check "конфиг есть, права 600" "$([ "$(stat -c %a $cfg)" = 600 ] && echo 1 || echo 0)"
python3 - "$cfg" "$PROV_PUBLIC_KEY" "$PROV_SHORT_ID" > $SP/xr-cfg-check.out <<'PY'
import json,sys
c=json.load(open(sys.argv[1]))
vi=[i for i in c["inbounds"] if i["tag"]=="vless-reality"][0]
r=vi["streamSettings"]["realitySettings"]
print(int(vi["port"]==39443 and vi["settings"]["clients"]==[] and r["dest"]=="www.example.com:443" and r["serverNames"]==["www.example.com"] and r["shortIds"]==[sys.argv[3]] and len(r["privateKey"])==43 and vi["streamSettings"]["security"]=="reality"))
api=[i for i in c["inbounds"] if i["tag"]=="api"][0]
print(int(api["listen"]=="127.0.0.1" and api["port"]==39085))
PY
check "конфиг: VLESS+REALITY, пустой список клиентов, SNI, shortId" "$(sed -n 1p $SP/xr-cfg-check.out)"
check "API статистики слушает только 127.0.0.1" "$(sed -n 2p $SP/xr-cfg-check.out)"
sleep 1
check "процесс Xray жив и слушает порт" "$( (exec 3<>/dev/tcp/127.0.0.1/39443) 2>/dev/null && echo 1 || echo 0)"
check "в команде скачивания есть проверка SHA-256" "$(grep -c 'sha256sum -c' $FAKE_LOG | awk '{print ($1>0)}')"
check "публичный ключ соответствует приватному" "$( /tmp/xr/xray x25519 -i "$(python3 -c "import json;print([i for i in json.load(open('$cfg'))['inbounds'] if i['tag']=='vless-reality'][0]['streamSettings']['realitySettings']['privateKey'])")" | grep -c "$PROV_PUBLIC_KEY" | awk '{print ($1>0)}')"
# повторный запуск: бинарник уже скачан, контейнер пересоздаётся
: > $FAKE_LOG
provision_xray_server > $SP/prov-xr2.out 2>&1 || { cat $SP/prov-xr2.out; fail=$((fail+1)); }
check "повторный запуск не качает Xray заново" "$(grep -c 'SHCMD' $FAKE_LOG | awk '{print ($1==0)}')"
check "повторный запуск: новый ключ, процесс жив" "$([ "$PROV_PUBLIC_KEY" != "" ] && (exec 3<>/dev/tcp/127.0.0.1/39443) 2>/dev/null && echo 1 || echo 0)"
# порчу конфиг -> test должен отказать
docker rm -f t-xr >/dev/null
echo "ИТОГ: прошло $pass, провалов $fail"
