import * as awg from "./awg.js";
import * as xray from "./xray.js";

// Реестр протоколов. Каждый протокол — адаптер с одинаковым набором функций,
// поэтому остальной код панели не знает, как устроен конкретный протокол.
//
//   generateClient(server)          → { privateKey, publicKey }
//   nextAddress(server, used)       → адрес нового клиента (для протоколов без адресов — "-")
//   syncClients(clients, server)    → применяет список клиентов на сервере
//   getClientStats(server)          → [{ publicKey, allowedIps, lastHandshake, rxBytes, txBytes }]
//   buildClientConfig(client, srv)  → текст конфига для клиента
//   buildAppLink(client, srv)       → ссылка для импорта в приложение
const PROTOCOLS = {
  awg: {
    id: "awg",
    title: "AmneziaWG",
    versions: ["2", "3.1"],
    generateClient: awg.generateKeypair,
    nextAddress: awg.nextAddress,
    syncClients: awg.syncPeers,
    getClientStats: awg.getPeerStats,
    buildClientConfig: awg.buildClientConfig,
    buildAppLink: awg.buildAmneziaVpnLink,
  },
  "vless-reality": {
    id: "vless-reality",
    title: "VLESS + REALITY (Xray)",
    versions: [],
    generateClient: xray.generateClient,
    nextAddress: xray.nextAddress,
    syncClients: xray.syncClients,
    getClientStats: xray.getClientStats,
    buildClientConfig: xray.buildClientConfig,
    buildAppLink: xray.buildAppLink,
  },
  hysteria2: {
    id: "hysteria2",
    title: "Hysteria2 (Xray)",
    versions: [],
    generateClient: xray.generateClient,
    nextAddress: xray.nextAddress,
    syncClients: xray.syncClients,
    getClientStats: xray.getClientStats,
    buildClientConfig: xray.buildClientConfig,
    buildAppLink: xray.buildAppLink,
  },
  shadowsocks: {
    id: "shadowsocks",
    title: "Shadowsocks-2022 (Xray)",
    versions: [],
    generateClient: xray.generateClient,
    nextAddress: xray.nextAddress,
    syncClients: xray.syncClients,
    getClientStats: xray.getClientStats,
    buildClientConfig: xray.buildClientConfig,
    buildAppLink: xray.buildAppLink,
  },
};

export const DEFAULT_PROTOCOL = "awg";

export function listProtocols() {
  return Object.values(PROTOCOLS).map(({ id, title, versions }) => ({ id, title, versions }));
}

export function getProtocol(id) {
  const p = PROTOCOLS[id || DEFAULT_PROTOCOL];
  if (!p) throw Object.assign(new Error(`Неизвестный протокол: ${id}`), { status: 400 });
  return p;
}

export function protocolOf(server) {
  return getProtocol(server?.protocol);
}

export { isAwg3 } from "./awg.js";
