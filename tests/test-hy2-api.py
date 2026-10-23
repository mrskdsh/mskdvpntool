import json, sys, time, re, http.cookiejar, urllib.request, urllib.error
BASE = "http://localhost:3193/api"
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"}, method=method)
    try:
        r = op.open(req); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
ok = True
def check(n, c, x=""):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n, x if not c else "")
def wait(jid):
    for _ in range(120):
        st, j = call(f"/servers/provision/{jid}")
        if j.get("status") in ("done", "error"): return j
        time.sleep(0.7)
    return {"status": "timeout"}
assert call("/auth/login", {"username": "adm", "password": "testpass123"})[0] == 200
st, pr = call("/servers/protocols")
check("список протоколов содержит hysteria2", {p["id"] for p in pr} >= {"awg", "vless-reality", "hysteria2"}, pr)
# сначала REALITY на 443/tcp, потом Hysteria2: порт 443/udp должен быть свободен
st, r = call("/servers/provision", {"name": "R1", "protocol": "vless-reality", "location": "local", "serverIp": "127.0.0.1", "xraySni": "localhost.test"})
check("REALITY принят", st == 202, r); wait(r["id"])
st, r = call("/servers/provision", {"name": "H1", "protocol": "hysteria2", "location": "local", "serverIp": "127.0.0.1"})
check("Hysteria2 принят", st == 202, r)
j = wait(r["id"])
check("установка Hysteria2 успешна", j.get("status") == "done", j)
check("в журнале Hysteria2 и udp", "Hysteria2" in json.dumps(j, ensure_ascii=False) and "/udp" in json.dumps(j))
st, servers = call("/servers"); by = {x["name"]: x for x in servers}
h = by.get("H1"); rr = by.get("R1")
check("сервер зарегистрирован как hysteria2", h and h["protocol"] == "hysteria2", h)
check("порт 443 свободен для UDP, хотя REALITY на 443/tcp", h and h["endpoint"] == "127.0.0.1:443" and rr and rr["endpoint"] == "127.0.0.1:443", (h or {}).get("endpoint"))
check("разные API-порты", h and rr and h["extraParams"]["apiPort"] != rr["extraParams"]["apiPort"], (h or {}).get("extraParams"))
check("public_key = отпечаток сертификата AA:BB:…", h and re.fullmatch(r"([0-9A-F]{2}:){31}[0-9A-F]{2}", h["public_key"]), (h or {}).get("public_key"))
st, p = call("/peers", {"name": "Петя", "serverId": h["id"]})
check("клиент Hysteria2 создан", st in (200, 201), p)
st, c = call(f"/peers/{p['id']}/config"); link = c.get("config", "")
check("ссылка hysteria2:// с отпечатком", link.startswith("hysteria2://") and f"pinSHA256={h['public_key']}" in link and "insecure=1" in link, link)
check("QR создаётся", call(f"/peers/{p['id']}/qr")[1].get("qr", "").startswith("data:image/png"))
check("блокировка / снятие", call(f"/peers/{p['id']}", {"blocked": True}, "PATCH")[0] == 200 and call(f"/peers/{p['id']}", {"blocked": False}, "PATCH")[0] == 200)
check("SNI не домен → 400", call("/servers/provision", {"name": "H2", "protocol": "hysteria2", "location": "local", "serverIp": "127.0.0.1", "xraySni": "1.2.3.4"})[0] == 400)
print("ИТОГ:", "ВСЕ ПРОШЛИ" if ok else "ЕСТЬ ОШИБКИ"); sys.exit(0 if ok else 1)
