import json, sys, time, hmac, hashlib, base64, http.cookiejar, urllib.request, urllib.error
PORT = sys.argv[1]; SEED = json.loads(sys.argv[2]); BASE = f"http://127.0.0.1:{PORT}"
ok = True
def check(n, c, x=""):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n, "" if c else x)
def client():
    cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    def call(path, body=None, method=None, headers=None, raw=False):
        h = {"Content-Type": "application/json"}; h.update(headers or {})
        req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
        try: r = op.open(req)
        except urllib.error.HTTPError as e: r = e
        data = r.read()
        try: j = json.loads(data or b"{}")
        except Exception: j = {}
        return (r.status, j, dict(r.headers)) if raw else (r.status, j)
    call.cj = cj
    return call
anon = client(); adm = client(); alice = client(); bob = client()

# 1. без входа закрыто
for p in ["/api/peers", "/api/servers", "/api/connection-requests", "/api/auth/me"]:
    check(f"без входа {p} → 401", anon(p)[0] == 401)
# 2. заголовки безопасности
st, _, h = anon("/api/health", raw=True)
check("заголовки безопасности есть", h.get("X-Content-Type-Options") == "nosniff" and h.get("X-Frame-Options") == "SAMEORIGIN" and "Referrer-Policy" in h, h)
check("X-Powered-By скрыт", "X-Powered-By" not in h)
# 3. вход и роли
check("вход админа", adm("/api/auth/login", {"username": "adm", "password": "testpass123"})[0] == 200)
check("вход alice", alice("/api/auth/login", {"username": "alice", "password": "alicepass1"})[0] == 200)
check("вход bob", bob("/api/auth/login", {"username": "bob", "password": "bobpass123"})[0] == 200)
check("клиент не видит список серверов (403)", alice("/api/servers")[0] == 403)
check("клиент не создаёт доступы (403)", alice("/api/peers", {"name": "x"}, "POST")[0] == 403)
check("клиент не запускает установку серверов (403)", alice("/api/servers/provision", {"name": "x"}, "POST")[0] == 403)
check("клиент не меняет доступ (403)", alice(f"/api/peers/{SEED['peerId']}", {"blocked": True}, "PATCH")[0] == 403)
# 4. чужие данные
check("владелец получает свою ссылку", alice(f"/api/peers/{SEED['peerId']}/config")[0] == 200)
check("чужой клиент не получает ссылку (403)", bob(f"/api/peers/{SEED['peerId']}/config")[0] == 403)
check("чужой клиент не получает QR (403)", bob(f"/api/peers/{SEED['peerId']}/qr")[0] == 403)
check("чужой клиент не видит доступ (403)", bob(f"/api/peers/{SEED['peerId']}")[0] == 403)
check("чужой клиент не видит в списке чужих", bob("/api/peers")[1] == [])
# 5. подделка токена
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=")
def forge(secret, claims):
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); body = b64(json.dumps(claims).encode())
    sig = b64(hmac.new(secret.encode(), head + b"." + body, hashlib.sha256).digest()); return (head + b"." + body + b"." + sig).decode()
tok = forge("wrong_secret_wrong_secret", {"id": "x", "role": "admin", "exp": int(time.time()) + 3600})
check("токен с чужой подписью отклонён", anon("/api/servers", headers={"Cookie": f"token={tok}"})[0] == 401)
tok = base64.urlsafe_b64encode(json.dumps({"alg": "none"}).encode()).rstrip(b"=").decode() + "." + base64.urlsafe_b64encode(json.dumps({"id": "x", "role": "admin"}).encode()).rstrip(b"=").decode() + "."
check("токен alg=none отклонён", anon("/api/servers", headers={"Cookie": f"token={tok}"})[0] == 401)
# 6. неправильные типы
check("логин с объектом вместо строки → 400", anon("/api/auth/login", {"username": {"$ne": ""}, "password": {"a": 1}})[0] == 400)
check("регистрация с массивом → 400", anon("/api/auth/register", {"username": ["a"], "password": "123456"})[0] == 400)
check("огромный пароль при регистрации → 400", anon("/api/auth/register", {"username": "bigpw", "password": "x" * 5000})[0] == 400)
# 7. смена пароля закрывает старые сессии
alice2 = client(); alice2("/api/auth/login", {"username": "alice", "password": "alicepass1"})
st, _ = alice("/api/auth/change-password", {"currentPassword": "alicepass1", "newPassword": "alicepass2"})
check("смена пароля прошла", st == 200)
check("текущая сессия продолжает работать (новый токен)", alice("/api/auth/me")[0] == 200)
check("другая старая сессия закрыта (401)", alice2("/api/auth/me")[0] == 401)
check("старый пароль не подходит", client()("/api/auth/login", {"username": "alice", "password": "alicepass1"})[0] == 401)
# 8. заявки: длина и суточный лимит
check("слишком длинное имя в заявке → 400", bob("/api/connection-requests", {"fullName": "я" * 500, "contact": "@x"}, "POST")[0] == 400)
codes = [bob("/api/connection-requests", {"fullName": "Боб", "contact": "@bob"}, "POST")[0] for _ in range(7)]
check("заявок за сутки не больше 5 (дальше 429)", codes[:5] == [201] * 5 and codes[5:] == [429, 429], codes)
check("слишком длинное обращение в поддержку → 400", bob("/api/support-tickets", {"message": "я" * 3000}, "POST")[0] == 400)
codes = [bob("/api/support-tickets", {"message": "помогите"}, "POST")[0] for _ in range(12)]
check("обращений за сутки не больше 10 (дальше 429)", codes[:10] == [201] * 10 and codes[10:] == [429, 429], codes)
# 9. перебор пароля: 5 неудач → блок, правильный пароль тоже не пускает
eve = client()
codes = [eve("/api/auth/login", {"username": "adm", "password": f"bad{i}"})[0] for i in range(7)]
check("после 5 неудач вход блокируется (429)", codes[:5] == [401] * 5 and codes[5] == 429, codes)
check("блок действует и на верный пароль", eve("/api/auth/login", {"username": "adm", "password": "testpass123"})[0] == 429)
# 10. один адрес перебирает много логинов
codes = [client()("/api/auth/login", {"username": f"user{i}", "password": "nope123"})[0] for i in range(40)]
check("перебор разных логинов с одного IP упирается в лимит (429)", 429 in codes, codes[-5:])
# 11. подделка X-Forwarded-For при прямом подключении (не с localhost) не обходит лимиты
import random, socket
try:
    _s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); _s.connect(("192.0.2.1", 9)); ext = _s.getsockname()[0]; _s.close()
except Exception:
    ext = "127.0.0.1"
if ext.startswith("127."):
    print("SKIP подмена X-Forwarded-For: у машины нет внешнего адреса, проверка пропущена")
else:
    BASE = f"http://{ext}:{PORT}"
    codes = []
    for i in range(45):
        c = client(); codes.append(c("/api/auth/login", {"username": f"spoof{i}", "password": "nope123"}, headers={"X-Forwarded-For": f"10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"})[0])
    check("подмена X-Forwarded-For не обходит лимит по IP (429)", 429 in codes, codes[-5:])
print("ИТОГ:", "ВСЕ ПРОШЛИ" if ok else "ЕСТЬ ОШИБКИ"); sys.exit(0 if ok else 1)
