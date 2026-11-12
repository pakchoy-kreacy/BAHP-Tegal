const { getDb } = require('../../lib/firebase');
const { route } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang, ambilRekap } = require('../../lib/query');
const { todayWIB, addDays } = require('../../lib/tanggal');

module.exports = route(['GET'], async ({ req, query }) => {
  await requireAdmin(req);
  const h = todayWIB();
  const r = rentang(query, addDays(h, -30), addDays(h, 30));
  return ambilRekap(getDb(), { ...r, lokasi: query.lokasi });
});
