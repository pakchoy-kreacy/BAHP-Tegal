const { getDb } = require('../../lib/firebase');
const { route, HttpError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang, ambilPemohon } = require('../../lib/query');
const { ubahPemohon } = require('../../lib/booking');
const { KODE_RE } = require('../../lib/validate');
const { todayWIB, addDays } = require('../../lib/tanggal');

module.exports = route(['GET', 'PATCH'], async ({ req, query, body }) => {
  await requireAdmin(req);
  const db = getDb();
  if (req.method === 'GET') {
    const h = todayWIB();
    const r = rentang(query, addDays(h, -7), addDays(h, 30));
    return ambilPemohon(db, { ...r, lokasi: query.lokasi, status: query.status, q: query.q });
  }
  const kode = String(body.kode || '').toUpperCase();
  if (!KODE_RE.test(kode)) throw new HttpError(400, 'Kode tidak valid.');
  return ubahPemohon(db, kode, { status: body.status, petugas: body.petugas, keterangan: body.keterangan });
});
