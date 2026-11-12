// Tulis CSV (aman dari formula injection) dan baca CSV (RFC 4180 sederhana).
function sel(v, { teks = false } = {}) {
  let s = v == null ? '' : String(v);
  if (teks && /^\d+$/.test(s)) return `"=""${s}"""`; // paksa Excel baca sebagai teks (nomor HP)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function keCsv(header, baris, kolomTeks = []) {
  const lines = [header.map((h) => sel(h)).join(',')];
  for (const r of baris) lines.push(r.map((v, i) => sel(v, { teks: kolomTeks.includes(i) })).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function bacaCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

module.exports = { keCsv, bacaCsv };
