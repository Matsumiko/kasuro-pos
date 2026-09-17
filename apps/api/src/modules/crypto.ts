const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 120_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derivePasswordKey(password, salt, PASSWORD_ITERATIONS);
  const digest = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${encode(salt)}$${encode(digest)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, digestText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || !saltText || !digestText)
    return false;
  const key = await derivePasswordKey(password, decode(saltText), iterations);
  const digest = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return constantTimeEqual(digest, decode(digestText));
}

export async function sha256(value: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
}

function encode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
