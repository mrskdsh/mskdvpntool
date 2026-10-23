import zlib from "node:zlib";
import { runOnHost, shellQuote } from "../hostExec.js";

async function inContainer(server, cmd) {
  return runOnHost(server, `docker exec ${shellQuote(server.container)} sh -c "${cmd.replace(/"/g, '\\"')}"`);
}

// Следующий свободный адрес в подсети сервера. usedAddresses — адреса уже созданных клиентов.
export function nextAddress(server, usedAddresses) {
  const used = new Set(usedAddresses.map((a) => Number(String(a).split(".").pop())));
  let n = server.address_start;
  while (used.has(n)) n++;
  if (n > 254) {
    throw Object.assign(new Error("В подсети сервера закончились свободные адреса"), { status: 409 });
  }
  return `${server.subnet_prefix}${n}`;
}

export async function generateKeypair(server) {
  const privateKey = await inContainer(server, `awg genkey`);
  // Ответ сервера попадает в команду оболочки, поэтому принимаем только ключ в формате base64
  if (!/^[A-Za-z0-9+/]{43}=$/.test(privateKey)) throw new Error("Сервер вернул неожиданный ответ вместо ключа");
  const publicKey = await inContainer(server, `echo '${privateKey}' | awg pubkey`);
  return { privateKey, publicKey };
}

export async function generatePresharedKey(server) {
  return inContainer(server, `awg genpsk`);
}

export async function syncPeers(peers, server) {
  const configPath = shellQuote(server.config_path);
  const rawContent = await inContainer(server, `cat ${configPath}`);
  const idx = rawContent.indexOf("[Peer]");
  const fullInterfaceBlock = (idx === -1 ? rawContent : rawContent.slice(0, idx)).trimEnd();

  const allowedKeys = [
    "PrivateKey", "ListenPort", "FwMark",
    "Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4",
    "HeaderProtectionKey", "ContentPaddingAddition", "RandomTrailers", "DisableCookies",
    "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout", "MaxHandshakeAttempts",
  ];
  const syncInterfaceBlock = fullInterfaceBlock
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "[Interface]") return true;
      const key = trimmed.split("=")[0]?.trim();
      return allowedKeys.includes(key);
    })
    .join("\n");

  const peerBlocks = peers
    .filter((p) => !p.blocked)
    .map(
      (p) =>
        `[Peer]\nPublicKey = ${p.publicKey}\nPresharedKey = ${p.presharedKey}\nAllowedIPs = ${p.address}/32`
    )
    .join("\n\n");

  const syncPath = `${server.config_path}.sync`;
  const syncPathQuoted = shellQuote(syncPath);
  const syncContent = `${syncInterfaceBlock}\n\n${peerBlocks}\n`;
  const syncB64 = Buffer.from(syncContent, "utf-8").toString("base64");
  await inContainer(server, `echo '${syncB64}' | base64 -d > ${syncPathQuoted}`);
  await inContainer(server, `awg syncconf ${shellQuote(server.interface)} ${syncPathQuoted}`);

  const diskContent = `${fullInterfaceBlock}\n\n${peerBlocks}\n`;
  const diskB64 = Buffer.from(diskContent, "utf-8").toString("base64");
  const tmpPath = shellQuote(`${server.config_path}.tmp`);
  await inContainer(
    server,
    `echo '${diskB64}' | base64 -d > ${tmpPath} && mv ${tmpPath} ${configPath}`
  );
}

export async function getPeerStats(server) {
  const out = await inContainer(server, `awg show ${shellQuote(server.interface)} dump`);
  const lines = out.split("\n").filter(Boolean);
  const peerLines = lines.slice(1);
  return peerLines.map((line) => {
    const parts = line.split("\t");
    const [publicKey, , , allowedIps, latestHandshake, rx, tx] = parts;
    return {
      publicKey,
      allowedIps,
      lastHandshake: Number(latestHandshake) || 0,
      rxBytes: Number(rx) || 0,
      txBytes: Number(tx) || 0,
    };
  });
}

const AWG_I1 =
  "<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>";

export function isAwg3(server) {
  return server.awg_version === "3.1";
}

function awg3Extra(server) {
  try {
    return JSON.parse(server.extra_params || "{}");
  } catch {
    return {};
  }
}

export function buildClientConfig(peer, server) {
  const dns = server.client_dns || "1.1.1.1";
  let awg3Lines = "";
  if (isAwg3(server)) {
    const extra = awg3Extra(server);
    awg3Lines =
      `HeaderProtectionKey = ${extra.headerProtectionKey}\n` +
      `ContentPaddingAddition = ${extra.contentPaddingAddition}\n` +
      `RandomTrailers = ${extra.randomTrailers}\n` +
      `MTU = 1280\n`;
  }
  return `[Interface]
PrivateKey = ${peer.privateKey}
Address = ${peer.address}/32
DNS = ${dns}
Jc = ${server.jc}
Jmin = ${server.jmin}
Jmax = ${server.jmax}
S1 = ${server.s1}
S2 = ${server.s2}
S3 = ${server.s3}
S4 = ${server.s4}
H1 = ${server.h1}
H2 = ${server.h2}
H3 = ${server.h3}
H4 = ${server.h4}
I1 = ${AWG_I1}
${awg3Lines}
[Peer]
PublicKey = ${server.public_key}
PresharedKey = ${peer.presharedKey}
AllowedIPs = 0.0.0.0/0
Endpoint = ${server.endpoint}
PersistentKeepalive = 25
`;
}

export function buildAmneziaVpnLink(peer, server) {
  // Для 3.1 формат собран по исходникам приложения Amnezia (поля из awgProtocolKeys),
  // но на реальном клиенте не проверен — в панели такая ссылка помечена «экспериментально».
  const v3 = isAwg3(server) ? awg3Extra(server) : null;
  const v3Fields = v3
    ? { HeaderProtectionKey: v3.headerProtectionKey, ContentPaddingAddition: v3.contentPaddingAddition }
    : {};
  const [host, port] = server.endpoint.split(":");
  const description = server.name || "VPN";

  const { jc: Jc, jmin: Jmin, jmax: Jmax, s1: S1, s2: S2, s3: S3, s4: S4, h1: H1, h2: H2, h3: H3, h4: H4 } = server;
  const I1 = AWG_I1;

  const clientIp = peer.address.split("/")[0];
  const configText = `[Interface]
Address = ${peer.address}
DNS = $PRIMARY_DNS, $SECONDARY_DNS
PrivateKey = ${peer.privateKey}
Jc = ${Jc}
Jmin = ${Jmin}
Jmax = ${Jmax}
S1 = ${S1}
S2 = ${S2}
S3 = ${S3}
S4 = ${S4}
H1 = ${H1}
H2 = ${H2}
H3 = ${H3}
H4 = ${H4}
I1 = ${I1}
I2 =
I3 =
I4 =
I5 =
${v3 ? `HeaderProtectionKey = ${v3.headerProtectionKey}\nContentPaddingAddition = ${v3.contentPaddingAddition}\n` : ""}
[Peer]
PublicKey = ${server.public_key}
PresharedKey = ${peer.presharedKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${host}:${port}
PersistentKeepalive = 25
`;

  const lastConfigObj = {
    H1, H2, H3, H4, I1, Jc, Jmax, Jmin, S1, S2, S3, S4,
    ...v3Fields,
    allowed_ips: ["0.0.0.0/0", "::/0"],
    clientId: peer.publicKey,
    client_ip: clientIp,
    client_priv_key: peer.privateKey,
    client_pub_key: peer.publicKey,
    config: configText,
    hostName: host,
    mtu: v3 ? "1280" : "1376",
    persistent_keep_alive: "25",
    port: Number(port),
    psk_key: peer.presharedKey,
    server_pub_key: server.public_key,
  };

  const payload = {
    containers: [
      {
        container: "amnezia-awg2",
        awg: {
          H1, H2, H3, H4, I1, I2: "", I3: "", I4: "", I5: "",
          Jc, Jmax, Jmin, S1, S2, S3, S4,
          ...v3Fields,
          last_config: JSON.stringify(lastConfigObj),
          port: String(port),
          protocol_version: v3 ? "3" : "2",
          transport_proto: "udp",
        },
      },
    ],
    defaultContainer: "amnezia-awg2",
    description,
    dns1: server.client_dns || "1.1.1.1",
    dns2: server.client_dns_secondary || "1.0.0.1",
    hostName: host,
  };

  const json = JSON.stringify(payload);
  const uncompressed = Buffer.from(json, "utf-8");

  const lengthHeader = Buffer.alloc(4);
  lengthHeader.writeUInt32BE(uncompressed.length, 0);
  const compressed = zlib.deflateSync(uncompressed, { level: 8 });
  const full = Buffer.concat([lengthHeader, compressed]);

  return `vpn://${full.toString("base64url")}`;
}
