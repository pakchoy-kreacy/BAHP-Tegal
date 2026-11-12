const { addDays, hariKe } = require('./tanggal');

// Rencana jadwal otomatis (fungsi murni, mudah diuji).
function rencanaJadwal(hariIni, jumlahHari, pola, libur) {
  const hasil = [], dilewati = [];
  const liburSet = new Set(libur || []);
  for (let i = 0; i <= jumlahHari; i++) {
    const tgl = addDays(hariIni, i);
    if (liburSet.has(tgl)) { dilewati.push(tgl); continue; }
    for (const p of pola) {
      if (p.hari.includes(hariKe(tgl))) hasil.push({ tanggal: tgl, lokasi: p.lokasi, kuota: p.kuota });
    }
  }
  return { hasil, dilewati };
}

module.exports = { rencanaJadwal };
