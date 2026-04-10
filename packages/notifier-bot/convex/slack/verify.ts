/**
 * Verifies a Slack request signature using HMAC-SHA256.
 * Returns the raw body string on success, null on failure.
 *
 * Verification steps (per Slack docs):
 *  1. Reject requests older than 5 minutes (replay attack prevention)
 *  2. Build base string: "v0:<timestamp>:<raw_body>"
 *  3. HMAC-SHA256 sign with the signing secret
 *  4. Compare "v0=<hex>" against X-Slack-Signature using timing-safe comparison
 *
 * If SLACK_SIGNING_SECRET is not set the check is skipped (local dev convenience).
 */
export async function verifySlackRequest(request: Request): Promise<string | null> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  const body = await request.text();

  if (!signingSecret) {
    console.warn("SLACK_SIGNING_SECRET not set — skipping request verification");
    return body;
  }

  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  const signature = request.headers.get("X-Slack-Signature");

  if (!timestamp || !signature) return null;

  // Reject stale requests (> 5 minutes old)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return null;

  const baseString = `v0:${timestamp}:${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(baseString),
  );

  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expected = `v0=${hex}`;

  if (!timingSafeEqual(expected, signature)) return null;

  return body;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
