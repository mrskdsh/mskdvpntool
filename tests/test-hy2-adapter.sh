#!/bin/bash
SP=$1
export PATH=$SP/fake3/bin:$PATH FAKE_LOG=$SP/fake3.log FAKE_STATE=/tmp/fake3-state
export DATA_DIR=$SP/data-hy PORT=3192 JWT_SECRET=testsecret_testsecret_testsecret_1234
: > $FAKE_LOG; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-* $DATA_DIR; mkdir -p $DATA_DIR
source $ROOT/lib/provision-awg.sh; source $ROOT/lib/provision-xray.sh
IS_REMOTE=false CONTAINER_NAME=t-hy XRAY_MODE=hysteria2 XRAY_PORT=39555 XRAY_API_PORT=39086 XRAY_SNI=www.example.com
provision_xray_server > $SP/prov-hy.out 2>&1 || { cat $SP/prov-hy.out; exit 1; }
printf 'PIN_SHA256=%s\nSNI=%s\n' "$PROV_PIN_SHA256" "$PROV_SNI" > $SP/prov-hy.env
mkdir -p /tmp/www && head -c 3145728 /dev/urandom > /tmp/www/f3m && head -c 1048576 /dev/urandom > /tmp/www/f1m
(cd /tmp/www && exec python3 -m http.server 39999 --bind 127.0.0.1 > /dev/null 2>&1) & WWW=$!
sleep 1
node $ROOT/tests/test-hy2-adapter.mjs $SP; rc=$?
docker rm -f t-hy; kill $WWW 2>/dev/null
exit $rc
