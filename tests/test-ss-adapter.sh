#!/bin/bash
SP=$1
export PATH=$SP/fake3/bin:$PATH FAKE_LOG=$SP/fake3.log FAKE_STATE=/tmp/fake3-state
export DATA_DIR=$SP/data-ss PORT=3193 JWT_SECRET=testsecret_testsecret_testsecret_1234
: > $FAKE_LOG; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-* $DATA_DIR; mkdir -p $DATA_DIR
source $ROOT/lib/provision-awg.sh; source $ROOT/lib/provision-xray.sh
IS_REMOTE=false CONTAINER_NAME=t-ss XRAY_MODE=shadowsocks XRAY_PORT=39565 XRAY_API_PORT=39087
provision_xray_server > $SP/prov-ss.out 2>&1 || { cat $SP/prov-ss.out; exit 1; }
cat $SP/prov-ss.out
printf 'KEY=%s\n' "$PROV_PUBLIC_KEY" > $SP/prov-ss.env
mkdir -p /tmp/www && head -c 3145728 /dev/urandom > /tmp/www/f3m && head -c 1048576 /dev/urandom > /tmp/www/f1m
(cd /tmp/www && exec python3 -m http.server 39999 --bind 127.0.0.1 > /dev/null 2>&1) & WWW=$!
sleep 1
node $ROOT/tests/test-ss-adapter.mjs $SP; rc=$?
docker rm -f t-ss >/dev/null; kill $WWW 2>/dev/null; pkill -x xray
exit $rc
