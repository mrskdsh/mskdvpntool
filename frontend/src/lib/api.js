async function call(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Ошибка запроса: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  login: (username, password) =>
    call("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username, password, extra) =>
    call("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, ...extra }),
    }),
  authConfig: () => call("/auth/config"),
  logout: () => call("/auth/logout", { method: "POST" }),
  me: () => call("/auth/me"),
  changePassword: (currentPassword, newPassword) =>
    call("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listPeers: (serverId) => call(`/peers${serverId ? `?serverId=${serverId}` : ""}`),
  createPeer: (data) => call("/peers", { method: "POST", body: JSON.stringify(data) }),
  getPeer: (id) => call(`/peers/${id}`),
  updatePeer: (id, patch) =>
    call(`/peers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePeer: (id) => call(`/peers/${id}`, { method: "DELETE" }),
  getConfig: (id) => call(`/peers/${id}/config`),
  getQr: (id) => call(`/peers/${id}/qr`),
  getVpnLink: (id) => call(`/peers/${id}/vpn-link`),
  getVpnLinkQr: (id) => call(`/peers/${id}/vpn-link/qr`),
  resetUsage: (id) => call(`/peers/${id}/reset-usage`, { method: "POST" }),
  resyncPeers: () => call("/peers/resync", { method: "POST" }),
  migratePeers: (data) => call("/peers/migrate", { method: "POST", body: JSON.stringify(data) }),

  listServers: () => call("/servers"),
  createServer: (data) => call("/servers", { method: "POST", body: JSON.stringify(data) }),
  updateServer: (id, patch) =>
    call(`/servers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteServer: (id) => call(`/servers/${id}`, { method: "DELETE" }),
  provisionServer: (data) => call("/servers/provision", { method: "POST", body: JSON.stringify(data) }),
  getProvisionJob: (id) => call(`/servers/provision/${id}`),

  listConnectionRequests: () => call("/connection-requests"),
  createConnectionRequest: ({ fullName, contact, comment }) =>
    call("/connection-requests", {
      method: "POST",
      body: JSON.stringify({ fullName, contact, comment }),
    }),
  updateConnectionRequest: (id, status) =>
    call(`/connection-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  listSupportTickets: () => call("/support-tickets"),
  createSupportTicket: (message) =>
    call("/support-tickets", { method: "POST", body: JSON.stringify({ message }) }),
  resolveSupportTicket: (id, response) =>
    call(`/support-tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ response, status: "resolved" }),
    }),

  listUsers: () => call("/users"),
  deleteUser: (id) => call(`/users/${id}`, { method: "DELETE" }),
  resetPassword: (id, newPassword) =>
    call(`/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
};
