import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(
  process.cwd(),
  "data",
  "publishing-process.db",
);
const SCHEMA_PATH = path.join(process.cwd(), "lib", "schema.sql");

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH || DEFAULT_DB_PATH;
}

export function ensureDataDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

export function openDatabase(dbPath = getDatabasePath()): Database.Database {
  ensureDataDirectory(dbPath);
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function initDatabase(db: Database.Database): void {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
}

export function closeDatabase(db: Database.Database): void {
  db.close();
}
