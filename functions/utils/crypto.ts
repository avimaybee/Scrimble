/**
 * Encrypts a string using AES-256-GCM.
 * Returns the result in the format "iv:ciphertext" (Base64 encoded).
 * @param data The string to encrypt.
 * @param encryptionKey The 32-byte hexadecimal encryption key.
 */
export async function encrypt(data: string, encryptionKey: string): Promise<string> {
  // SECURITY: key material never logged
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('ENCRYPTION_KEY is missing or invalid. Check your environment settings.');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const matches = encryptionKey.match(/.{1,2}/g);
  if (!matches) {
    throw new Error('ENCRYPTION_KEY is not a valid hexadecimal string.');
  }

  const keyBuffer = Uint8Array.from(
    matches.map((byte) => parseInt(byte, 16))
  );

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(data)
  );

  const ivBase64 = btoa(String.fromCharCode(...iv));
  const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));

  return `${ivBase64}:${ciphertextBase64}`;
}

/**
 * Decrypts a string using AES-256-GCM.
 * The input must be in the format "iv:ciphertext" (Base64 encoded).
 * @param encryptedData The string to decrypt.
 * @param encryptionKey The 32-byte hexadecimal encryption key.
 */
export async function decrypt(encryptedData: string, encryptionKey: string): Promise<string> {
  // SECURITY: key material never logged
  const [ivBase64, ciphertextBase64] = encryptedData.split(':');
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error('Invalid encrypted data format. Expected iv:ciphertext.');
  }

  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));

  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('ENCRYPTION_KEY is missing or invalid. Check your environment settings.');
  }

  const matches = encryptionKey.match(/.{1,2}/g);
  if (!matches) {
    throw new Error('ENCRYPTION_KEY is not a valid hexadecimal string.');
  }

  const keyBuffer = Uint8Array.from(
    matches.map((byte) => parseInt(byte, 16))
  );

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}
