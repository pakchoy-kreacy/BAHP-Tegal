const { route } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { rentang, ambilRekap } = require('../../lib/query');
const { todayWIB, addDays } = require('../../lib/tanggal');

module.exports = route(['GET'], async ({ req, query }) => {
  await requireAdmin(req);
  const h = todayWIB();
  return ambilRekap({ ...rentang(query, addDays(h, -30), addDays(h, 30)), lokasi: query.lokasi });
});
