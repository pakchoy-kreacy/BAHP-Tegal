// Ganti PIN admin: POST {lama, baru}
const { route, HttpError } = require('../../lib/http');
const { requireAdmin, cekPin, simpanPin, buatCookie } = require('../../lib/auth');
const { batasi } = require('../../lib/ratelimit');

module.exports = route(['POST'], async ({ req, res, body }) => {
  await requireAdmin(req);
  await batasi(req, 'ganti-pin', 5, 600);
  if (!(await cekPin(body.lama))) throw new HttpError(401, 'PIN lama salah.');
  const baru = String(body.baru || '');
  if (!/^\d{6,12}$/.test(baru)) throw new HttpError(400, 'PIN baru harus 6 sampai 12 angka.');
  await simpanPin(baru);
  // sesi lain otomatis tidak berlaku; sesi ini diperbarui
  res.setHeader('Set-Cookie', await buatCookie(req));
  return { diganti: true };
});
