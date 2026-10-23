#!/bin/bash
SP=$1
export PATH=$SP/fake3/bin:$PATH FAKE_LOG=$SP/fake3.log FAKE_STATE=/tmp/fake3-state
export DATA_DIR=$SP/data-xr PORT=3190 JWT_SECRET=testsecret_testsecret_testsecret_1234
: > $FAKE_LOG; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-* $DATA_DIR; mkdir -p $DATA_DIR
source $ROOT/lib/provision-awg.sh; source $ROOT/lib/provision-xray.sh
IS_REMOTE=false CONTAINER_NAME=t-xr XRAY_PORT=39443 XRAY_API_PORT=39085 XRAY_SNI=localhost.test
provision_xray_server > $SP/prov-xr.out 2>&1 || { cat $SP/prov-xr.out; exit 1; }
printf 'PUBLIC_KEY=%s\nSHORT_ID=%s\nSNI=%s\n' "$PROV_PUBLIC_KEY" "$PROV_SHORT_ID" "$PROV_SNI" > $SP/prov-xr.env
# dest — локальный TLS 1.3 сервер вместо внешнего сайта; xray перезапускаем с этим конфигом
cfg=/opt/skdsh-panel/xray-t-xr/config.json
sed -i 's#"dest": "[^"]*"#"dest": "127.0.0.1:8443"#' $cfg
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/dest.key -out /tmp/dest.crt -days 1 -subj "/CN=localhost.test" 2>/dev/null
openssl s_server -accept 8443 -tls1_3 -cert /tmp/dest.crt -key /tmp/dest.key -www > /dev/null 2>&1 & DEST=$!
mkdir -p /tmp/www && head -c 3145728 /dev/urandom > /tmp/www/f3m && head -c 1048576 /dev/urandom > /tmp/www/f1m
(cd /tmp/www && exec python3 -m http.server 39999 --bind 127.0.0.1 > /dev/null 2>&1) & WWW=$!
docker restart t-xr; sleep 1.5
node $ROOT/tests/test-xray-adapter.mjs $SP; rc=$?
docker rm -f t-xr; kill $DEST $WWW 2>/dev/null
exit $rc
