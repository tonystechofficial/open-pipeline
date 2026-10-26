// A D1-shaped binding on Node's SQLite with every migration applied: the real SQL, as D1 runs it.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function d1Binding() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  const prepare = (sql) => {
    const stmt = db.prepare(sql);
    let args = [];
    const api = {
      bind(...values) { args = values; return api; },
      async run() { const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { success: true, results: stmt.all(...args) }; },
    };
    return api;
  };
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
