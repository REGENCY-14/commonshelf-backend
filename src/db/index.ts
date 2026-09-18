import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { RequestSource } from "../types.js";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "commonshelf.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('telegram', 'web')),
    result_count INTEGER NOT NULL,
    telegram_chat_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const insertSearchStmt = db.prepare(
  `INSERT INTO searches (query, source, result_count, telegram_chat_id) VALUES (?, ?, ?, ?)`
);

export function logSearch(params: {
  query: string;
  source: RequestSource;
  resultCount: number;
  telegramChatId?: string | number;
}): void {
  insertSearchStmt.run(
    params.query,
    params.source,
    params.resultCount,
    params.telegramChatId != null ? String(params.telegramChatId) : null
  );
}

export default db;
