import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class LocalD1Database {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    // Enforce foreign keys (Requirement constraint)
    this.db.pragma('foreign_keys = ON');
  }

  getDb(): Database.Database {
    return this.db;
  }

  // D1-compatible API
  prepare(query: string) {
    return new LocalD1PreparedStatement(this.db, query);
  }

  async batch(statements: LocalD1PreparedStatement[]) {
    return this.db.transaction(() => {
      return statements.map(stmt => {
        return stmt.runSync();
      });
    })();
  }
}

class LocalD1PreparedStatement {
  private params: any[] = [];

  constructor(private db: Database.Database, private query: string) {}

  bind(...params: any[]) {
    this.params = params;
    return this;
  }

  async first() {
    try {
      const stmt = this.db.prepare(this.query);
      const row = stmt.get(...this.params);
      return row || null;
    } catch (e) {
      console.error(`D1 Error (first) for query "${this.query}":`, e);
      throw e;
    }
  }

  async all() {
    try {
      const stmt = this.db.prepare(this.query);
      const results = stmt.all(...this.params);
      return { results };
    } catch (e) {
      console.error(`D1 Error (all) for query "${this.query}":`, e);
      throw e;
    }
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    try {
      const stmt = this.db.prepare(this.query);
      const info = stmt.run(...this.params);
      return {
        success: true,
        meta: {
          changes: info.changes,
          last_row_id: info.lastInsertRowid,
        }
      };
    } catch (e) {
      console.error(`D1 Error (run) for query "${this.query}":`, e);
      throw e;
    }
  }
}

export function applyMigrations(db: Database.Database, migrationsDir: string) {
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`Migrations directory not found at ${migrationsDir}`);
    return;
  }
  const files = fs.readdirSync(migrationsDir).sort();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;

    const row = db.prepare('SELECT id FROM _migrations WHERE name = ?').get(file);
    if (!row) {
      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      try {
        db.transaction(() => {
          db.exec(sql);
          db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
        })();
      } catch (e: any) {
        console.warn(`Migration ${file} failed: ${e.message}. Continuing...`);
        // Record it as applied anyway so we don't keep retrying broken historical migrations
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      }
    }
  }
}
