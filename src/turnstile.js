export async function verifyTurnstile(token, remoteIp) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return true;

  if (!token) return false;

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: remoteIp || "" }),
    });
    const data = await res.json();
    return data.success === true;
  } catch (e) {
    console.error("[turnstile] verification error:", e.message);
    return false;
  }
}
