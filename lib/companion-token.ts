import crypto from "node:crypto";

// ===== 桌面伴侣只读令牌（HMAC-SHA256 签名，使用 AUTH_SECRET，无状态）=====
// 不新增数据表；令牌内含 userId、sessionVersion、scope、exp。
// 密码或 sessionVersion 改变后，verify 时回查 getSessionUser 会使旧令牌失效。

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天

export interface CompanionTokenPayload {
  userId: number;
  sessionVersion: number;
  scope: "companion:read";
  exp: number;
}

function b64url(data: string | Buffer): string {
  return Buffer.isBuffer(data)
    ? data.toString("base64url")
    : Buffer.from(data).toString("base64url");
}

function hmac(secret: string, input: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

export function signCompanionToken(
  userId: number,
  sessionVersion: number,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): { token: string; expiresAt: string } {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload: CompanionTokenPayload = {
    userId,
    sessionVersion,
    scope: "companion:read",
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = hmac(secret, signingInput);
  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyCompanionToken(
  token: string,
  secret: string,
): CompanionTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const signingInput = `${header}.${body}`;

  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(signature, "base64url");
    b = Buffer.from(hmac(secret, signingInput), "base64url");
  } catch {
    return null;
  }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: CompanionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (payload.scope !== "companion:read") return null;
  if (typeof payload.userId !== "number" || typeof payload.sessionVersion !== "number") {
    return null;
  }
  return payload;
}
