import json, sys, sqlite3, uuid, http.cookiejar, urllib.request, urllib.error, re
SP = sys.argv[1]; BASE = "http://localhost:3104/api"
db = sqlite3.connect(__import__("os").environ["DATA_DIR"] + "/panel.db"); db.row_factory = sqlite3.Row
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"}, method=method or ("POST" if body is not None else "GET"))
    try:
        r = op.open(req); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
ok = True
def check(name, cond, extra=""):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name, extra if not cond else "")

assert call("/auth/login", {"username": "adm", "password": "testpass123"})[0] == 200
st, servers = call("/servers"); by = {s["name"]: s for s in servers}
s2, s31 = by["S2"], by["S31"]
check("регистрация: S2 = версия 2, extraParams пусто", s2["awg_version"] == "2" and s2["extraParams"] is None)
ep = s31["extraParams"]
check("регистрация: S31 = версия 3.1, ключ 44 символа base64",
      s31["awg_version"] == "3.1" and re.fullmatch(r"[A-Za-z0-9+/]{43}=", ep["headerProtectionKey"] or ""), s31)
check("регистрация: S31 доп. параметры по умолчанию",
      ep["contentPaddingAddition"] == "0-64" and ep["randomTrailers"] == "on" and ep["disableCookies"] == "off", ep)
check("регистрация: S31 S1-S4 >= 12 в БД", all(int(s31[k]) >= 12 for k in ("s1","s2","s3","s4")), [s31[k] for k in ("s1","s2","s3","s4")])

good = {k: s31[k] for k in ("endpoint","container","interface","public_key","preshared_key","jc","jmin","jmax","s1","s2","s3","s4","h1","h2","h3","h4")}
def post(**over):
    body = {"name":"X","endpoint":"1.1.1.1:1","container":"c","configPath":"/p","interface":"i","publicKey":"k","presharedKey":"p",
            "jc":"1","jmin":"1","jmax":"2","s1":"20","s2":"30","s3":"40","s4":"15","h1":"1","h2":"2","h3":"3","h4":"4","subnetPrefix":"10.1.1."}
    body.update(over); return call("/servers", body)
KEY = "A"*43 + "="
check("POST 3.1 без ключа → 400", post(awgVersion="3.1")[0] == 400)
check("POST 3.1 с кривым ключом → 400", post(awgVersion="3.1", extraParams={"headerProtectionKey": "short"})[0] == 400)
check("POST 3.1 с S4=11 → 400", post(awgVersion="3.1", s4="11", extraParams={"headerProtectionKey": KEY})[0] == 400)
check("POST версия 9 → 400", post(awgVersion="9")[0] == 400)
check("POST 3.1 с кривым флагом → 400", post(awgVersion="3.1", extraParams={"headerProtectionKey": KEY, "randomTrailers": "maybe"})[0] == 400)
check("POST 3.1 с кривым ContentPaddingAddition → 400", post(awgVersion="3.1", extraParams={"headerProtectionKey": KEY, "contentPaddingAddition": "a-b"})[0] == 400)
st, r = post(name="OK31", awgVersion="3.1", extraParams={"headerProtectionKey": KEY})
check("POST корректный 3.1 → 201", st == 201, (st, r))
st, r = post(name="OK2")
check("POST без версии → 201 и версия 2", st == 201 and db.execute("SELECT awg_version FROM servers WHERE name='OK2'").fetchone()[0] == "2")

check("PATCH S31 s3=5 → 400 (проверка и без смены версии)", call(f"/servers/{s31['id']}", {"s3": "5"}, "PATCH")[0] == 400)
check("PATCH S31 только имя → 200", call(f"/servers/{s31['id']}", {"name": "S31b"}, "PATCH")[0] == 200)
check("PATCH S31 кривой ключ → 400", call(f"/servers/{s31['id']}", {"extraParams": {"headerProtectionKey": "x"}}, "PATCH")[0] == 400)
call(f"/servers/{s31['id']}", {"name": "S31"}, "PATCH")

# Конфиги и ссылки через маршруты пиров
def add_peer(server, name, addr):
    pid = str(uuid.uuid4())
    db.execute("INSERT INTO peers (id,name,public_key,private_key,preshared_key,address,server_id) VALUES (?,?,?,?,?,?,?)",
               (pid, name, "pub-"+name, "priv-"+name, "PSK", addr, server["id"])); db.commit(); return pid
p2, p31 = add_peer(s2, "p2", "10.60.1.2"), add_peer(s31, "p31", "10.61.1.2")
st, c31 = call(f"/peers/{p31}/config"); conf31 = c31.get("config", "")
check("конфиг 3.1 содержит HeaderProtectionKey = ключ сервера и MTU 1280",
      f"HeaderProtectionKey = {ep['headerProtectionKey']}" in conf31 and "MTU = 1280" in conf31 and "RandomTrailers = on" in conf31, conf31)
st, c2 = call(f"/peers/{p2}/config"); conf2 = c2.get("config", "")
check("конфиг 2.0 без параметров 3.x", st == 200 and not re.search(r"HeaderProtectionKey|RandomTrailers|ContentPadding|MTU", conf2), conf2)
check("vpn:// для 3.1 выдаётся (экспериментально)", (lambda r: r[0] == 200 and r[1]["link"].startswith("vpn://"))(call(f"/peers/{p31}/vpn-link")))
check("vpn:// для 2.0 работает", (lambda r: r[0] == 200 and r[1]["link"].startswith("vpn://"))(call(f"/peers/{p2}/vpn-link")))
check("QR-маршрут vpn:// для 3.1 работает", call(f"/peers/{p31}/vpn-link/qr")[0] == 200)
check("QR для .conf 3.1 работает", call(f"/peers/{p31}/qr")[0] == 200)
st, peers = call("/peers"); ver = {p["name"]: p["awgVersion"] for p in peers}
check("список пиров отдаёт awgVersion", ver.get("p31") == "3.1" and ver.get("p2") == "2", ver)

print("\nИТОГ:", "ВСЕ ПРОШЛИ" if ok else "ЕСТЬ ПАДЕНИЯ")
