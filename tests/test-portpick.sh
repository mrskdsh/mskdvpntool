#!/bin/bash
SP=$1
export PATH=$SP/fakess:$SP/fake3/bin:$PATH FAKE_LOG=$SP/fake3.log FAKE_STATE=/tmp/fake3-state
source $ROOT/lib/provision-awg.sh; source $ROOT/lib/provision-xray.sh
pass=0; fail=0
check() { if [ "$2" = "1" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1 $3"; fi; }
run() { # режим, кандидаты, busy_tcp, busy_udp → печатает PROV_PORT или ERR
  rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-*; : > $FAKE_LOG
  ( IS_REMOTE=false CONTAINER_NAME=t-pp XRAY_MODE=$1 XRAY_PORT=${2%% *} XRAY_PORT_CANDIDATES="$2" XRAY_API_PORT=39089; export FAKE_BUSY_TCP="$3" FAKE_BUSY_UDP="$4"
    provision_xray_server > $SP/pp.out 2>&1 && echo "OK $PROV_PORT" || echo "ERR $(grep -o 'ERROR: .*' $SP/pp.out | head -1)" )
  docker rm -f t-pp >/dev/null 2>&1; pkill -x xray
}
r=$(run reality "443 8443 2053" "443" ""); check "REALITY: 443/tcp занят (Caddy) → 8443" "$([ "$r" = "OK 8443" ] && echo 1 || echo 0)" "$r"
r=$(run hysteria2 "443 8443" "443" ""); check "Hysteria2: 443/tcp занят, но UDP свободен → 443" "$([ "$r" = "OK 443" ] && echo 1 || echo 0)" "$r"
r=$(run shadowsocks "443 8443" "443" ""); check "Shadowsocks: 443/tcp занят → 8443" "$([ "$r" = "OK 8443" ] && echo 1 || echo 0)" "$r"
r=$(run shadowsocks "443 8443" "" "443"); check "Shadowsocks: 443/udp занят → 8443" "$([ "$r" = "OK 8443" ] && echo 1 || echo 0)" "$r"
r=$(run reality "443" "443" ""); check "порт задан вручную и занят → понятная ошибка" "$(echo "$r" | grep -q 'ERR ERROR: порт 443 на сервере уже занят' && echo 1 || echo 0)" "$r"
r=$(run reality "443 8443" "" ""); check "всё свободно → первый (443)" "$([ "$r" = "OK 443" ] && echo 1 || echo 0)" "$r"
echo "ИТОГ: прошло $pass, провалов $fail"
