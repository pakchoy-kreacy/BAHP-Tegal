const pg = require('pg');
const { HttpError } = require('./http');

pg.types.setTypeParser(1082, (v) => v); // kolom date tetap string yyyy-MM-dd

let pool;
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new HttpError(500, 'Server belum dikonfigurasi (DATABASE_URL).');
    pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
    pool.on('error', () => {});
  }
  return pool;
}

// Satu query -> array baris.
async function q(text, params) { return (await getPool().query(text, params)).rows; }

// Transaksi: fn menerima fungsi query yang mengembalikan {rows, rowCount}.
async function tx(fn) {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn((text, params) => c.query(text, params));
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* abaikan */ }
    throw e;
  } finally { c.release(); }
}

async function tutup() { if (pool) { await pool.end(); pool = null; } }

module.exports = { q, tx, tutup };
