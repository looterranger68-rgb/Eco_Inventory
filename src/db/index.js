const path = require('path');
const fs = require('fs');

const isPostgres = process.env.DATABASE_TYPE === 'postgres';

let dbInstance = null;

if (isPostgres) {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: process.env.PG_PORT || 5432,
    database: process.env.PG_DATABASE || 'ecoinventory',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  });

  dbInstance = {
    type: 'postgres',
    async query(text, params = []) {
      // Map $1, $2 or convert if needed
      return await pool.query(text, params);
    },
    async all(text, params = []) {
      const res = await pool.query(text, params);
      return res.rows;
    },
    async get(text, params = []) {
      const res = await pool.query(text, params);
      return res.rows[0] || null;
    },
    async run(text, params = []) {
      const res = await pool.query(text, params);
      return { rowCount: res.rowCount };
    }
  };
} else {
  const Database = require('better-sqlite3');
  const dbDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'ecoinventory.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Unified async-like API for SQLite
  dbInstance = {
    type: 'sqlite',
    raw: sqlite,
    async all(sql, params = []) {
      // replace $1, $2 with ?
      const sanitizedSql = sql.replace(/\$\d+/g, '?');
      const stmt = sqlite.prepare(sanitizedSql);
      return stmt.all(...params);
    },
    async get(sql, params = []) {
      const sanitizedSql = sql.replace(/\$\d+/g, '?');
      const stmt = sqlite.prepare(sanitizedSql);
      return stmt.get(...params) || null;
    },
    async run(sql, params = []) {
      const sanitizedSql = sql.replace(/\$\d+/g, '?');
      const stmt = sqlite.prepare(sanitizedSql);
      const info = stmt.run(...params);
      return { lastID: info.lastInsertRowid, changes: info.changes };
    },
    async exec(sql) {
      return sqlite.exec(sql);
    }
  };
}

module.exports = dbInstance;
