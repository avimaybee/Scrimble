import keytar from 'keytar';

const SERVICE_NAME = 'scrimble-cli';

export async function setSecret(key: string, value: string) {
  await keytar.setPassword(SERVICE_NAME, key, value);
}

export async function getSecret(key: string): Promise<string | null> {
  return await keytar.getPassword(SERVICE_NAME, key);
}

export async function deleteSecret(key: string) {
  await keytar.deletePassword(SERVICE_NAME, key);
}
