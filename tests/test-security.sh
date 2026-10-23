#!/bin/bash
SP=$1; PORT=3195
export DATA_DIR=$SP/data-sec PORT JWT_SECRET=testsecret_testsecret_testsecret_1234 NODE_ENV=development
rm -rf $DATA_DIR; mkdir -p $DATA_DIR
cd $ROOT
SEED=$(node tests/seed-sec.mjs | tail -1)
node src/server.js > $SP/server-sec.log 2>&1 & SRV=$!
sleep 2
python3 tests/test-security.py $PORT "$SEED"; rc=$?
# сервер не должен запускаться со слабым секретом
JWT_SECRET=change_me DATA_DIR=$SP/data-sec2 PORT=3196 timeout 5 node src/server.js > $SP/weak.out 2>&1; wr=$?
if [ $wr -ne 0 ] && grep -q "JWT_SECRET" $SP/weak.out; then echo "PASS слабый JWT_SECRET → сервер не стартует"; else echo "FAIL слабый JWT_SECRET не остановил сервер (код $wr)"; rc=1; fi
kill $SRV
exit $rc
