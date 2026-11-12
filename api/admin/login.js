// GET: cek sesi. POST {pin}: login. DELETE: keluar.
const { route, HttpError } = require('../../lib/http');
const { requireAdmin, cekPin, buatCookie, cookieHapus } = require('../../lib/auth');
const { batasi } = require('../../lib/ratelimit');

module.exports = route(['GET', 'POST', 'DELETE'], async ({ req, res, body }) => {
  if (req.method === 'GET') { await requireAdmin(req); return { login: true }; }
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', cookieHapus()); return { login: false }; }
  if (req.headers['x-bhap'] !== '1') throw new HttpError(403, 'Permintaan tidak valid.');
  await batasi(req, 'login', 5, 600);
  await batasi(req, 'login', 60, 600, { global: true });
  if (!(await cekPin(body.pin))) {
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, 'PIN salah.');
  }
  res.setHeader('Set-Cookie', await buatCookie(req));
  return { login: true };
});
