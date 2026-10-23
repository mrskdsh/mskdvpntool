#!/bin/bash
SP=$1
export PATH=$SP/fake2/bin:$PATH FAKE_LOG=$SP/fake2b.log
source $ROOT/lib/provision-awg.sh
IS_REMOTE=false; WG_PORT=39001
PANEL_URL=http://localhost:3104; ADMIN_USERNAME=adm; ADMIN_PASSWORD=testpass123
for spec in "2:S2:t-reg-v2:10.60.1" "3.1:S31:t-reg-v31:10.61.1"; do
  IFS=: read ver nm cn sn <<< "$spec"
  AWG_VERSION=$ver; NAME=$nm; CONTAINER_NAME=$cn; SUBNET_BASE=$sn; SERVER_IP=9.9.9.9
  provision_awg_server > $SP/prov.out 2>&1 || { cat $SP/prov.out; exit 1; }
  register_server_via_api || { echo "register failed for $nm"; exit 1; }
done
rm -rf /opt/skdsh-panel/configs-t-reg-*
