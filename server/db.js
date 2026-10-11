const path = require('path');
const fs = require('fs');

const isPostgres = process.env.DATABASE_TYPE === 'postgres';

let dbInstance = null;

if (isPostgres) {
  const { Pool } = require('pg');
  // Prefer a single DATABASE_URL; fall back to discrete PG_* variables.
  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: process.env.PG_PORT || 5432,
          database: process.env.PG_DATABASE || 'ecoinventory',
          user: process.env.PG_USER || 'postgres',
          password: process.env.PG_PASSWORD || 'postgres',
        }
  );

  dbInstance = {
    type: 'postgres',
    async all(text, params = []) {
      const res = await pool.query(text, params);
      return res.rows;
    },
    async get(text, params = []) {
      const res = await pool.query(text, params);
      return res.rows[0] || null;
    },
    async run(text, params = []) {
      const insertTable = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(text)?.[1]?.toLowerCase();
      const tablesWithIds = new Set(['sellers', 'suppliers', 'products', 'orders', 'order_items', 'sales', 'stock_logs']);
      const query = insertTable && tablesWithIds.has(insertTable) && !/\bRETURNING\b/i.test(text) ? `${text} RETURNING id` : text;
      const res = await pool.query(query, params);
      const id = res.rows && res.rows[0] ? res.rows[0].id : null;
      return { rowCount: res.rowCount, changes: res.rowCount, lastID: id, id };
    },
    async exec(text) {
      return pool.query(text);
    },
    async transaction(work) {
      const client = await pool.connect();
      const tx = {
        async all(text, params = []) { return (await client.query(text, params)).rows; },
        async get(text, params = []) { return (await client.query(text, params)).rows[0] || null; },
        async run(text, params = []) {
          const insertTable = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(text)?.[1]?.toLowerCase();
          const tablesWithIds = new Set(['sellers', 'suppliers', 'products', 'orders', 'order_items', 'sales', 'stock_logs']);
          const query = insertTable && tablesWithIds.has(insertTable) && !/\bRETURNING\b/i.test(text) ? `${text} RETURNING id` : text;
          const result = await client.query(query, params);
          const id = result.rows && result.rows[0] ? result.rows[0].id : null;
          return { rowCount: result.rowCount, changes: result.rowCount, lastID: id, id };
        },
        async exec(text) { return client.query(text); }
      };
      try {
        await client.query('BEGIN');
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  };
} else {
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'ecoinventory.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = {
    type: 'sqlite',
    raw: sqlite,
    async all(sql, params = []) {
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
