const admin = require('firebase-admin');
const { HttpError } = require('./http');

function bacaKredensial() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  let json = raw;
  if (!raw.startsWith('{')) json = Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(json);
  if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

let db;
function getDb() {
  if (db) return db;
  if (!admin.apps.length) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (emulator && !process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-bhap' });
    } else {
      let sa;
      try { sa = bacaKredensial(); } catch { sa = null; }
      if (!sa) throw new HttpError(500, 'Server belum dikonfigurasi (FIREBASE_SERVICE_ACCOUNT).');
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
  }
  db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

module.exports = { admin, getDb, FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp };
