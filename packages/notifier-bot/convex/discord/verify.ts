function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

/**
 * Verifies a Discord interaction request signature using Ed25519.
 * Returns the raw body string on success, null on failure.
 *
 * Discord signs every interaction with Ed25519 using the app's public key.
 * Message: X-Signature-Timestamp + raw body bytes.
 *
 */
export async function verifyDiscordRequest(
  request: Request,
): Promise<string | null> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const body = await request.text();

  if (!publicKey) {
    console.error('DISCORD_PUBLIC_KEY not set');
    return null;
  }

  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  if (!signature || !timestamp) return null;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const isValid = await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );

    return isValid ? body : null;
  } catch {
    return null;
  }
}
