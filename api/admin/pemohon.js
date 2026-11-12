const { route, HttpError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang, ambilPemohon } = require('../../lib/query');
const { ubahPemohon, tambahPemohon, hapusPemohon, imporPemohon } = require('../../lib/booking');
const { KODE_RE } = require('../../lib/validate');
const { todayWIB, addDays } = require('../../lib/tanggal');

const kodeDari = (v) => {
  const k = String(v || '').trim().toUpperCase();
  if (!KODE_RE.test(k)) throw new HttpError(400, 'Kode tidak valid.');
  return k;
};

// GET daftar | POST tambah ({...data, paksa}) atau impor ({impor:[...]}) | PATCH ubah | DELETE ?kode=
module.exports = route(['GET', 'POST', 'PATCH', 'DELETE'], async ({ req, query, body }) => {
  await requireAdmin(req);
  if (req.method === 'GET') {
    const h = todayWIB();
    const r = rentang(query, addDays(h, -7), addDays(h, 30));
    return ambilPemohon({ ...r, lokasi: query.lokasi, status: query.status, q: query.q });
  }
  if (req.method === 'POST') {
    if (body.impor !== undefined) return imporPemohon(body.impor);
    return tambahPemohon(body, body.paksa === true);
  }
  if (req.method === 'DELETE') return hapusPemohon(kodeDari(query.kode));
  const { kode, paksa, ...patch } = body;
  return ubahPemohon(kodeDari(kode), patch, paksa === true);
});
