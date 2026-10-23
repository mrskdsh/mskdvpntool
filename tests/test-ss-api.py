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
check("список протоколов содержит shadowsocks", {p["id"] for p in pr} == {"awg", "vless-reality", "hysteria2", "shadowsocks"}, pr)
st, r = call("/servers/provision", {"name": "R1", "protocol": "vless-reality", "location": "local", "serverIp": "127.0.0.1", "xraySni": "localhost.test"})
check("REALITY принят", st == 202, r); wait(r["id"])
st, r = call("/servers/provision", {"name": "S1", "protocol": "shadowsocks", "location": "local", "serverIp": "127.0.0.1"})
check("Shadowsocks принят", st == 202, r)
j = wait(r["id"])
check("установка Shadowsocks успешна", j.get("status") == "done", j)
check("в журнале Shadowsocks и TCP и UDP", "Shadowsocks" in json.dumps(j, ensure_ascii=False) and "TCP и UDP" in json.dumps(j, ensure_ascii=False))
st, servers = call("/servers"); by = {x["name"]: x for x in servers}
s1 = by.get("S1"); rr = by.get("R1")
check("зарегистрирован как shadowsocks", s1 and s1["protocol"] == "shadowsocks", s1)
check("порт 443 занят REALITY → Shadowsocks взял другой", s1 and s1["endpoint"] == "127.0.0.1:8443" and rr["endpoint"] == "127.0.0.1:443", (s1 or {}).get("endpoint"))
check("разные API-порты", s1 and s1["extraParams"]["apiPort"] != rr["extraParams"]["apiPort"], (s1 or {}).get("extraParams"))
check("ключ сервера — 16 байт base64", s1 and len(__import__("base64").b64decode(s1["public_key"])) == 16, (s1 or {}).get("public_key"))
st, p = call("/peers", {"name": "Петя", "serverId": s1["id"]})
check("клиент Shadowsocks создан", st in (200, 201), p)
st, c = call(f"/peers/{p['id']}/config"); link = c.get("config", "")
check("ссылка ss:// с методом 2022-blake3-aes-128-gcm", link.startswith("ss://2022-blake3-aes-128-gcm:") and "@127.0.0.1:8443#" in link, link)
check("QR создаётся", call(f"/peers/{p['id']}/qr")[1].get("qr", "").startswith("data:image/png"))
check("блокировка / снятие", call(f"/peers/{p['id']}", {"blocked": True}, "PATCH")[0] == 200 and call(f"/peers/{p['id']}", {"blocked": False}, "PATCH")[0] == 200)
st, c2 = call(f"/peers/{p['id']}/config")
check("после снятия блокировки ссылка та же", c2.get("config") == link)
st, r = call("/servers/provision", {"name": "S2", "protocol": "shadowsocks", "location": "local", "serverIp": "127.0.0.1", "wgPort": 0})
check("порт 0 → 400", st == 400, r)
print("ИТОГ:", "ВСЕ ПРОШЛИ" if ok else "ЕСТЬ ОШИБКИ"); sys.exit(0 if ok else 1)
