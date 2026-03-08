/**
 * Decrypts a string using AES-256-GCM.
 * The input must be in the format "iv:ciphertext" (Base64 encoded).
 * @param encryptedData The string to decrypt.
 * @param encryptionKey The 32-byte hexadecimal encryption key.
 */
export async function decrypt(encryptedData: string, encryptionKey: string): Promise<string> {
  const [ivBase64, ciphertextBase64] = encryptedData.split(':');
  if (!ivBase64 || !ciphertextBase64) {
    throw new Error('Invalid encrypted data format. Expected iv:ciphertext.');
  }

  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
  const keyBuffer = Uint8Array.from(
    encryptionKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
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
