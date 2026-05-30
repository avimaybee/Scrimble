import fs from 'fs';
import path from 'path';

export class LocalBucket {
  constructor(private baseDir: string) {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async put(key: string, body: string | ArrayBuffer | Uint8Array) {
    const fullPath = path.join(this.baseDir, key);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    let dataToWrite: any;
    if (typeof body === 'string') {
      dataToWrite = body;
    } else {
      dataToWrite = Buffer.from(body);
    }
    
    fs.writeFileSync(fullPath, dataToWrite);
    return { key };
  }

  async get(key: string) {
    const fullPath = path.join(this.baseDir, key);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    return {
      key,
      text: async () => content,
      json: async () => JSON.parse(content),
      body: content as any,
      size: content.length,
      httpEtag: 'local',
    };
  }

  async delete(key: string) {
    const fullPath = path.join(this.baseDir, key);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async list(options?: { prefix?: string; cursor?: string }) {
    // Basic implementation for orphaned cleanup if ever called
    const results: any[] = [];
    return { objects: results, truncated: false };
  }
}
