#!/bin/bash
# Запускает панель с поддельным docker и гоняет Python-тест API: api.sh <тест.py> <порт> <каталог shims: fake2|fake3> [register-both]
SP=$1; PY=$2; PORT=$3; SH=$4; REG=$5
export PATH=$SP/$SH/bin:$PATH FAKE_LOG=$SP/$SH.log FAKE_STATE=/tmp/fake3-state
export DATA_DIR=$SP/data-api-$PORT PORT JWT_SECRET=testsecret_testsecret_testsecret_1234 NODE_ENV=development
: > $FAKE_LOG; pkill -x xray; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-* $DATA_DIR; mkdir -p $DATA_DIR
cd $ROOT && node $ROOT/tests/seed-admin.mjs
node src/server.js > $SP/server-$PORT.log 2>&1 & SRV=$!
sleep 2
if [ "$REG" = register-both ]; then bash $ROOT/tests/register-both.sh $SP || { kill $SRV; exit 1; }; fi
python3 $ROOT/tests/$PY $SP; rc=$?
kill $SRV; pkill -x xray; rm -rf /tmp/fake3-state /opt/skdsh-panel/xray-*
exit $rc
