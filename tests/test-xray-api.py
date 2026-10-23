import json, sys, time, http.cookiejar, urllib.request, urllib.error, base64, re
BASE = "http://localhost:3191/api"
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
check("список протоколов: awg и vless-reality", st == 200 and {p["id"] for p in pr} >= {"awg", "vless-reality"}, pr)
base = {"name": "XR1", "protocol": "vless-reality", "location": "local", "serverIp": "127.0.0.1", "wgPort": 39443}
check("неизвестный протокол → 400", call("/servers/provision", {**base, "protocol": "nope"})[0] == 400)
check("SNI-IP → 400", call("/servers/provision", {**base, "xraySni": "1.2.3.4"})[0] == 400)
check("SNI с пробелом → 400", call("/servers/provision", {**base, "xraySni": "bad host;id"})[0] == 400)
check("порт 0 → 400", call("/servers/provision", {**base, "wgPort": 0})[0] == 400)
st, r = call("/servers", {"name": "m", "protocol": "vless-reality", "endpoint": "1.1.1.1:443", "container": "c", "configPath": "/x", "publicKey": "k"})
check("ручное подключение не для AWG → 400", st == 400, r)
st, r = call("/servers/provision", {**base, "xraySni": "localhost.test"})
check("задание принято", st == 202, r)
j = wait(r["id"])
check("установка Xray завершилась успешно", j.get("status") == "done", j)
text = json.dumps(j, ensure_ascii=False)
check("в журнале VLESS + REALITY и порт", "VLESS + REALITY" in text and "39443" in text)
st, servers = call("/servers")
s = next((x for x in servers if x["name"] == "XR1"), None)
check("сервер зарегистрирован с протоколом", s and s["protocol"] == "vless-reality" and s["endpoint"] == "127.0.0.1:39443", s)
ex = (s or {}).get("extraParams") or {}
check("extraParams: sni, shortId, порты", ex.get("sni") == "localhost.test" and re.fullmatch(r"[0-9a-f]{16}", ex.get("shortId", "")) and ex.get("port") == 39443 and ex.get("apiPort") == 10085, ex)
check("публичный ключ REALITY сохранён", re.fullmatch(r"[A-Za-z0-9_-]{43}", (s or {}).get("public_key", "")))
check("приватного ключа REALITY нет в ответе API", "privateKey" not in json.dumps(s))
# второй сервер: порт и API-порт подбираются без конфликтов
st, r2 = call("/servers/provision", {**base, "name": "XR2", "wgPort": None, "xraySni": "localhost.test"})
j2 = wait(r2["id"]) if st == 202 else {}
st, servers = call("/servers"); s2 = next((x for x in servers if x["name"] == "XR2"), None)
check("второй Xray: другой порт API", s2 and s2["extraParams"]["apiPort"] == 10086 and s2["endpoint"].endswith(":443"), s2 and (s2["endpoint"], s2["extraParams"]))
# клиенты
st, p = call("/peers", {"name": "Вася", "serverId": s["id"]})
check("клиент создан (адрес «-»)", st in (200, 201) and p.get("address") == "-", p)
st, c = call(f"/peers/{p['id']}/config")
link = c.get("config", "")
check("конфиг — ссылка vless://", st == 200 and link.startswith("vless://") and "security=reality" in link and "sni=localhost.test" in link, link)
st, l2 = call(f"/peers/{p['id']}/vpn-link")
check("vpn-link — та же ссылка", l2.get("link") == link)
st, q = call(f"/peers/{p['id']}/qr")
check("QR создаётся", st == 200 and q.get("qr", "").startswith("data:image/png;base64,"))
st, lst = call("/peers"); item = next(x for x in lst if x["id"] == p["id"])
check("в списке клиентов есть protocol", item.get("protocol") == "vless-reality", item)
# блокировка и снятие
check("блокировка клиента", call(f"/peers/{p['id']}", {"blocked": True}, "PATCH")[0] == 200)
check("снятие блокировки", call(f"/peers/{p['id']}", {"blocked": False}, "PATCH")[0] == 200)
# PATCH с awg-параметрами для Xray
check("PATCH awgVersion у Xray-сервера → 400", call(f"/servers/{s['id']}", {"awgVersion": "3.1"}, "PATCH")[0] == 400)
# перенос между разными протоколами запрещён: нужен AWG-сервер
print("ИТОГ:", "ВСЕ ПРОШЛИ" if ok else "ЕСТЬ ОШИБКИ"); sys.exit(0 if ok else 1)
