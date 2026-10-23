#!/bin/bash
# Проверка обновления боевой панели с каждой прежней версии схемы базы
SP=$1; cd $ROOT
rc=0; port=3210
for rev in 08320fd b536ce1 a1f712a 5435ee9; do
  node tests/test-upgrade.mjs $rev $SP $port || rc=1
  port=$((port+1))
done
[ $rc -eq 0 ] && echo "ИТОГ: прошло, провалов 0" || echo "ИТОГ: провалов есть"
exit $rc
