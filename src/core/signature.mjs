// The proofs the public intake checks before touching anything: Cal.com's signature and shared
// secrets. Web Crypto only, so the same code runs in Node's tests and in the Worker.

/** Constant-time comparison; an empty or missing value never matches. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** True when `signatureHex` is the HMAC-SHA256 of the raw body with `secret` (Cal.com's x-cal-signature-256). */
export async function verifyHmacSha256(secret, rawBody, signatureHex) {
  if (!secret || !signatureHex) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return safeEqual(hex, String(signatureHex).trim().toLowerCase());
}
