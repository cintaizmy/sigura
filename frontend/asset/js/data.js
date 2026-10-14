// =========================================================
// Data penyakit + helper
// 3 kelas yang bisa dideteksi model (sesuai dokumen SRS):
//   sehat, jamur, bakteri  <- key HARUS sama dengan CLASSES di backend/app.py
// Penyakit lain (bisaScan: false) hanya untuk ensiklopedia & diagnosis validator.
// foto: nama file contoh di asset/image/ (tanpa .jpg)
// =========================================================

const PENYAKIT = {
  sehat: {
    nama: "Sehat",
    latin: "",
    bisaScan: true,
    ringkasan: "Tidak ditemukan tanda infeksi jamur maupun bakteri. Warna tubuh, sirip, dan kulit ikan terlihat normal.",
    gejala: [],
    penyebab: [],
    pencegahan: [],
    penanganan: [
      "Pertahankan kualitas air: ganti sebagian air secara rutin dan buang sisa pakan.",
      "Beri pakan sesuai kebutuhan, jangan berlebihan.",
      "Pantau ikan secara berkala dan scan ulang bila muncul perubahan warna atau luka."
    ]
  },
  bakteri: {
    kategori: "Bakteri",
    nama: "Infeksi bakteri",
    latin: "Aeromoniasis / Motile Aeromonas Septicemia (Aeromonas hydrophila)",
    bisaScan: true,
    foto: "bercak_merah",
    ringkasan: "Infeksi bakteri, terutama Aeromonas, yang ditandai bercak atau luka kemerahan di tubuh dan sirip. Pada kasus berat perut bisa membengkak. Mudah menular saat kualitas air buruk.",
    // Jenis penyakit yang termasuk kelas ini (model tidak membedakan jenisnya)
    jenis: [
      {
        nama: "Bercak merah",
        latin: "Motile Aeromonas Septicemia (Aeromonas hydrophila)",
        ciri: "Bercak atau luka merah di kulit dan pangkal sirip, sisik lepas, sirip geripis. Paling sering menyerang gurame."
      },
      {
        nama: "Perut kembung (dropsy)",
        latin: "Umumnya akibat Aeromonas",
        ciri: "Perut membesar berisi cairan, sisik berdiri seperti sisik nanas, mata menonjol, ikan diam di dasar."
      },
      {
        nama: "Busuk sirip dan insang (columnaris)",
        latin: "Flavobacterium columnare",
        ciri: "Tepi sirip rusak dan memutih, bercak putih keabuan di punggung atau mulut, insang membusuk."
      }
    ],
    gejala: [
      "Bercak atau luka merah di kulit",
      "Sirip geripis, tepinya memutih atau kemerahan",
      "Sisik lepas di sekitar luka",
      "Perut membesar tidak wajar",
      "Sisik berdiri seperti sisik nanas",
      "Ikan lemas, nafsu makan turun"
    ],
    penyebab: ["Bakteri Aeromonas hydrophila", "Kualitas air buruk dan bahan organik tinggi", "Ikan stres, terluka, atau padat tebar berlebihan"],
    pencegahan: ["Jaga kualitas air dan kebersihan kolam", "Hindari padat tebar berlebihan", "Tangani ikan dengan hati-hati agar tidak luka", "Gunakan pakan berkualitas"],
    penanganan: [
      "Segera pisahkan ikan yang sakit ke wadah karantina.",
      "Ganti sebagian air kolam dan kurangi pemberian pakan sementara.",
      "Rendam ikan dengan larutan garam ikan sesuai dosis anjuran.",
      "Konsultasikan ke penyuluh perikanan sebelum memakai antibiotik."
    ]
  },
  jamur: {
    kategori: "Jamur",
    nama: "Infeksi jamur",
    latin: "Saprolegniasis (Saprolegnia sp.)",
    bisaScan: true,
    ringkasan: "Jamur air tumbuh sebagai lapisan putih atau keabu-abuan seperti kapas, biasanya pada bagian tubuh yang sudah terluka.",
    jenis: [
      {
        nama: "Saprolegniasis",
        latin: "Saprolegnia sp.",
        ciri: "Lapisan putih atau abu-abu seperti kapas di kulit, sirip, atau telur, biasanya di bagian yang luka."
      },
      {
        nama: "Borok merah (EUS)",
        latin: "Epizootic Ulcerative Syndrome (Aphanomyces invadans)",
        ciri: "Awalnya bercak merah, lalu menjadi borok atau luka dalam yang makin melebar. Sering muncul saat suhu air turun."
      },
      {
        nama: "Busuk insang jamur",
        latin: "Branchiomycosis (Branchiomyces sp.)",
        ciri: "Insang pucat dan berbercak, ikan megap-megap di permukaan. Terkait air kotor dan suhu tinggi."
      }
    ],
    gejala: ["Lapisan putih seperti kapas di kulit atau sirip", "Luka yang tidak kunjung sembuh atau melebar jadi borok", "Insang pucat, ikan megap-megap", "Ikan berenang lambat"],
    penyebab: ["Jamur air Saprolegnia, Aphanomyces, atau Branchiomyces", "Luka akibat penanganan atau gesekan", "Suhu air rendah"],
    pencegahan: ["Hindari ikan terluka saat panen atau pemindahan", "Jaga suhu dan kebersihan air", "Buang telur atau ikan mati secepatnya"],
    penanganan: [
      "Pisahkan ikan yang terinfeksi.",
      "Rendam dengan larutan garam ikan atau obat anti jamur sesuai dosis di kemasan.",
      "Perbaiki kualitas air dan buang kotoran di dasar kolam."
    ]
  },
  white_spot: {
    kategori: "Parasit",
    nama: "White spot",
    latin: "Ichthyophthiriasis (Ichthyophthirius multifiliis)",
    bisaScan: false,
    ringkasan: "Penyakit parasit yang memunculkan bintik putih kecil tersebar di tubuh, sirip, dan insang. Menyebar cepat di kolam padat.",
    gejala: ["Bintik putih kecil seperti taburan garam", "Ikan sering menggesekkan badan", "Napas cepat, sering naik ke permukaan"],
    penyebab: ["Parasit Ichthyophthirius multifiliis", "Perubahan suhu air mendadak", "Ikan baru yang tidak dikarantina"],
    pencegahan: ["Karantina ikan baru sebelum dicampur", "Jaga suhu air tetap stabil", "Hindari padat tebar tinggi"],
    penanganan: [
      "Pisahkan ikan yang menunjukkan bintik putih.",
      "Rendam dengan larutan garam ikan atau obat anti parasit sesuai dosis di kemasan.",
      "Ulangi perawatan sesuai petunjuk karena parasit punya beberapa tahap hidup."
    ]
  },
  kutu_ikan: {
    kategori: "Parasit",
    nama: "Kutu ikan",
    latin: "Argulosis (Argulus sp.)",
    bisaScan: false,
    ringkasan: "Parasit berbentuk pipih yang menempel di kulit dan mengisap cairan tubuh ikan, sering meninggalkan luka kemerahan.",
    gejala: ["Parasit pipih terlihat menempel di kulit", "Titik merah bekas gigitan", "Ikan sering menggesekkan badan"],
    penyebab: ["Parasit Argulus sp.", "Air kolam jarang dikuras", "Masuknya ikan atau air dari sumber terinfeksi"],
    pencegahan: ["Keringkan dan bersihkan kolam secara berkala", "Saring air masuk", "Karantina ikan baru"],
    penanganan: [
      "Cabut kutu yang terlihat dengan pinset secara hati-hati.",
      "Rendam ikan dengan larutan garam ikan sesuai dosis anjuran.",
      "Kuras dan keringkan kolam untuk memutus siklus parasit."
    ]
  }
};

// Kelas yang bisa dideteksi model
const KELAS_SCAN = Object.keys(PENYAKIT).filter(k => PENYAKIT[k].bisaScan);

// ---------- Helper umum ----------
// Riwayat scan & konsultasi sekarang disimpan di backend (lihat api.js).
function formatTanggal(iso) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// ---------- Konsultasi lanjutan ----------
// Bentuk data dari backend (satu hasil scan):
// { id, tanggal, label, confidence, demo, image, pengguna,
//   konsultasi: null | {
//     id, status: "menunggu_bayar" | "menunggu" | "selesai",
//     catatanUser, dikirim, pengguna: { nama, lokasi },   <- dari pembudidaya
//     diagnosis, keparahan, pesan, validator, divalidasi, <- dari validator
//     dibaca                                              <- sudah dilihat pembudidaya
//   },
//   pembayaran: null | { kode, jumlah, metode, status: "menunggu" | "gagal" | "lunas", dibuat, dibayar } }

const KEPARAHAN = { ringan: "Ringan", sedang: "Sedang", berat: "Berat" };

const STATUS_BAYAR = { menunggu: "Menunggu pembayaran", gagal: "Gagal", lunas: "Lunas" };

function rupiah(n) {
  return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

function namaDiagnosis(key) {
  if (key === "lainnya") return "Penyakit lain";
  return PENYAKIT[key] ? PENYAKIT[key].nama : key;
}

// Cegah teks dari pengguna dieksekusi sebagai HTML
function escapeHTML(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
