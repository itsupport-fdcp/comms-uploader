import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'data', 'comms_uploader.db');

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });

  // Load existing DB from disk, or create a new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new SQL.Database();
    initSchema(db);
    saveDb(db);
  }

  return db;
}

function initSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      url TEXT NOT NULL,
      file_type TEXT,
      original_size INTEGER,
      compressed_size INTEGER,
      uploaded_by TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      current_version INTEGER DEFAULT 1,
      FOREIGN KEY(event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS upload_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      filename TEXT,
      s3_key TEXT,
      url TEXT,
      uploaded_by TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(upload_id) REFERENCES uploads(id)
    );

    CREATE TABLE IF NOT EXISTS upload_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER,
      action TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default events
  db.run(`
    INSERT OR IGNORE INTO events (id, name, year) VALUES
      (1, 'PFIM', 2026),
      (2, 'Filmart', 2026),
      (3, 'CinePanalo', 2026);
  `);
}

export function saveDb(database: Database) {
  const data = database.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export { getDb };
