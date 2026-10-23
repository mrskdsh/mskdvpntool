#!/bin/bash
# Прогон provision_awg_server с подменёнными docker/awg/iptables и НАСТОЯЩИМ awg-genparams.
SP=$1
export PATH=$SP/fake2/bin:$PATH
export FAKE_LOG=$SP/fake2.log
: > "$FAKE_LOG"
source $ROOT/lib/provision-awg.sh

pass=0; fail=0
check() { if [ "$2" = "1" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1 $3"; fi; }
b64key='^[A-Za-z0-9+/]{43}=$'
IS_REMOTE=false; WG_PORT=39001; SUBNET_BASE=10.50.1

# --- 2.0: поведение не должно измениться ---
CONTAINER_NAME=t-v2; AWG_VERSION=2
provision_awg_server > $SP/prov.out 2>&1 || { cat $SP/prov.out; exit 1; }
conf=/opt/skdsh-panel/configs-t-v2/t-v2.conf
check "2.0: образ старый"      "$(grep -c 'image=vernette/amneziawg:v1.0.20260223 entry=awg-genparams' $FAKE_LOG | awk '{print ($1>0)}')"
check "2.0: нет HPK"           "$([ -z "$PROV_HPK" ] && echo 1 || echo 0)"
check "2.0: в конфиге нет 3.x" "$(grep -cE 'HeaderProtectionKey|RandomTrailers|ContentPaddingAddition' $conf | awk '{print ($1==0)}')"
check "2.0: S1-S4 как выдал генератор (без перегенерации)" "$([ -n "$PROV_S3" ] && echo 1 || echo 0)"

# --- 3.1: много прогонов, чтобы покрыть ветки S3/S4 < 12 ---
regen=0
for i in $(seq 1 25); do
  CONTAINER_NAME=t-v31-$i; AWG_VERSION=3.1
  provision_awg_server > $SP/prov.out 2>&1 || { echo "ПРОВАЛ провижининга #$i"; cat $SP/prov.out; fail=$((fail+1)); continue; }
  conf=/opt/skdsh-panel/configs-$CONTAINER_NAME/$CONTAINER_NAME.conf
  ok_s=1
  for v in $PROV_S1 $PROV_S2 $PROV_S3 $PROV_S4; do [ "$v" -ge 12 ] 2>/dev/null || ok_s=0; done
  uniq_n=$(printf '%s\n' $PROV_S1 $PROV_S2 $PROV_S3 $PROV_S4 | sort -u | wc -l)
  check "3.1 #$i: S1-S4 >= 12" $ok_s "(S=$PROV_S1/$PROV_S2/$PROV_S3/$PROV_S4)"
  check "3.1 #$i: S1-S4 различны" $([ "$uniq_n" = 4 ] && echo 1 || echo 0)
  check "3.1 #$i: HPK = 32 байта base64" $([[ "$PROV_HPK" =~ $b64key ]] && echo 1 || echo 0) "($PROV_HPK)"
  check "3.1 #$i: HPK в серверном конфиге" $(grep -qF "HeaderProtectionKey = $PROV_HPK" $conf && echo 1 || echo 0)
  check "3.1 #$i: RandomTrailers и ContentPaddingAddition в конфиге" $(grep -q 'RandomTrailers = on' $conf && grep -q 'ContentPaddingAddition = 0-64' $conf && echo 1 || echo 0)
  check "3.1 #$i: S3/S4 в конфиге совпадают с результатом" $(grep -q "^S3 = $PROV_S3\$" $conf && grep -q "^S4 = $PROV_S4\$" $conf && echo 1 || echo 0)
  check "3.1 #$i: [Interface] один, без [Peer]" $([ "$(grep -c '^\[' $conf)" = 1 ] && echo 1 || echo 0)
done
check "3.1: использован образ v3.1" "$(grep -c 'image=vernette/amneziawg:v3.1.20260812 entry=awg$' $FAKE_LOG | awk '{print ($1>0)}')"
check "3.1: docker run -d с образом 3.1" "$(grep -c 'docker run -d .*vernette/amneziawg:v3.1.20260812' $FAKE_LOG | awk '{print ($1>=25)}')"
# сколько прогонов реально упёрлись в S3/S4<12 (по сырому выводу генератора — оценка покрытия ветки)
low=0; for i in $(seq 1 200); do o=$(sh $SP/vernette-src/repo/scripts/awg-genparams.sh | grep -E '^S[34] ' | head -2 | awk '{print $3}'); for v in $o; do [ "$v" -lt 12 ] && { low=$((low+1)); break; }; done; done
echo "Покрытие: в $low из 200 выдач генератора S3 или S4 < 12 (значит ветка перегенерации реально нужна и срабатывала)"
echo "ИТОГ: прошло $pass, провалов $fail"
rm -rf /opt/skdsh-panel/configs-t-v2 /opt/skdsh-panel/configs-t-v31-*
