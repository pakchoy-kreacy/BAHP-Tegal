// Publik: konfigurasi web Firebase untuk login admin (bukan rahasia, tapi dijaga di env).
const { route, HttpError } = require('../lib/http');

module.exports = route(['GET'], async () => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY, projectId = process.env.FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) throw new HttpError(500, 'Login admin belum dikonfigurasi (FIREBASE_WEB_API_KEY / FIREBASE_PROJECT_ID).');
  return { apiKey, projectId, authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com` };
}, { cache: 'public, s-maxage=300' });
