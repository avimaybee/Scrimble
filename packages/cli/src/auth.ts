import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.scrimble');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function authenticateUser() {
  console.log('Authenticating via browser...');
  
  // Simulate an oauth flow
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const token = `mock_token_${Date.now()}`;
  
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  const config = { token };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  
  console.log('✅ Successfully authenticated!');
  return token;
}

export async function getStoredToken(): Promise<string | null> {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return config.token || null;
  } catch (e) {
    return null;
  }
}
