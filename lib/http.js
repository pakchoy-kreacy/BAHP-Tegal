class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const HANDLED = Symbol('handled');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function bodyJson(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { throw new HttpError(400, 'Format data tidak valid.'); }
  }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

function query(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.query || {})) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

// Pembungkus handler: cek metode, parse body, tangkap error.
function route(methods, fn, opts = {}) {
  return async (req, res) => {
    try {
      res.setHeader('Cache-Control', opts.cache || 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, 'Metode tidak diizinkan.');
      }
      const ctx = { req, res, body: req.method === 'GET' || req.method === 'DELETE' ? {} : bodyJson(req), query: query(req) };
      const data = await fn(ctx);
      if (data === HANDLED) return;
      send(res, 200, { ok: true, data });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
      console.error(e);
      send(res, 500, { ok: false, error: 'Terjadi kesalahan server. Coba lagi sebentar lagi.' });
    }
  };
}

module.exports = { HttpError, HANDLED, route, send };
