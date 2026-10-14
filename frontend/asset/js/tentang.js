// =========================================================
// Halaman Tentang: daftar kondisi dari data.js + FAQ
// =========================================================

// Daftar kondisi yang dikenali, otomatis sesuai data.js
const classList = document.getElementById("class-list");
if (classList) {
  classList.innerHTML = Object.entries(PENYAKIT).filter(([, p]) => p.bisaScan).map(([key, p]) => {
    const sehat = key === "sehat";
    const href = sehat ? "scan.html" : `penyakit.html#${key}`;
    return `<li><a href="${href}" class="pill ${sehat ? "pill-healthy" : "pill-sick"}">${escapeHTML(p.nama)}</a></li>`;
  }).join("");
}

// FAQ: hanya satu jawaban terbuka dalam satu waktu
const faqs = document.querySelectorAll(".faq details");
faqs.forEach(d => d.addEventListener("toggle", () => {
  if (d.open) faqs.forEach(o => { if (o !== d) o.open = false; });
}));

// ---------- Cara kerja: langkah interaktif ----------
const LANGKAH = [
  {
    judul: "Foto ikan",
    teks: "Pengguna memotret gurame langsung dengan kamera atau mengunggah foto dari galeri. Ikan sebaiknya terlihat utuh dari samping, di tempat yang terang.",
    ikon: '<path d="M17 10l-3 5H9a4 4 0 0 0-4 4v17a4 4 0 0 0 4 4h30a4 4 0 0 0 4-4V19a4 4 0 0 0-4-4h-5l-3-5z"/><circle cx="24" cy="27" r="7.5"/>'
  },
  {
    judul: "Cek kualitas",
    teks: "Sebelum dianalisis, browser mengecek pencahayaan, ketajaman, dan resolusi foto. Kalau kualitasnya kurang, pengguna diberi peringatan agar bisa foto ulang.",
    ikon: '<circle cx="24" cy="24" r="16"/><path d="M16 24.5l5.5 5.5L32 19"/>'
  },
  {
    judul: "Analisis model",
    teks: "Foto dikirim ke model deep learning yang membaca pola warna dan tekstur pada tubuh ikan, lalu memberi label kondisi beserta tingkat keyakinannya.",
    ikon: '<rect x="12" y="12" width="24" height="24" rx="4"/><path d="M19 5v7M29 5v7M19 36v7M29 36v7M5 19h7M5 29h7M36 19h7M36 29h7"/><rect x="19" y="19" width="10" height="10" rx="2"/>'
  },
  {
    judul: "Hasil dan saran",
    teks: "Pengguna melihat status ikan, tingkat keyakinan model, gejala yang biasa muncul, dan checklist langkah penanganan awal yang bisa langsung dilakukan.",
    ikon: '<rect x="10" y="6" width="28" height="36" rx="4"/><path d="M17 17h14M17 24h14M17 31h8"/>'
  },
  {
    judul: "Validasi ahli",
    teks: "Jika ragu, pengguna bisa mengirim konsultasi lanjutan. Penyuluh perikanan memeriksa foto, mengonfirmasi atau mengoreksi hasil, lalu mengirim saran penanganan.",
    ikon: '<circle cx="20" cy="16" r="7"/><path d="M6 40c0-7.7 6.3-12 14-12 3 0 5.7.6 8 1.8"/><path d="M29 36l4 4 9-9"/>'
  }
];

const howto = document.getElementById("howto");
if (howto) {
  const tabs = howto.querySelectorAll(".howto-steps button");
  const durasi = 6000;
  let aktif = 0;
  let timer = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function tampil(i) {
    aktif = i;
    const l = LANGKAH[i];
    tabs.forEach((t, n) => {
      t.setAttribute("aria-selected", n === i);
      t.classList.toggle("done", n < i);
    });
    // Di HP: geser daftar langkah agar tombol aktif terlihat (tanpa menggulir halaman)
    const list = howto.querySelector(".howto-steps");
    if (list.scrollWidth > list.clientWidth) {
      const btn = tabs[i].parentElement;
      list.scrollTo({ left: btn.offsetLeft - 16, behavior: reduce ? "auto" : "smooth" });
    }

    document.getElementById("howto-icon").innerHTML =
      `<svg viewBox="0 0 48 48" width="48" height="48">${l.ikon}</svg>`;
    document.getElementById("howto-count").textContent = `Langkah ${i + 1} dari ${LANGKAH.length}`;
    document.getElementById("howto-title").textContent = l.judul;
    document.getElementById("howto-text").textContent = l.teks;

    const panel = howto.querySelector(".howto-panel");
    panel.classList.remove("swap");
    void panel.offsetWidth; // ulang animasi
    panel.classList.add("swap");

    const bar = document.getElementById("howto-bar");
    bar.style.transition = "none";
    bar.style.width = "0";
    if (timer && !reduce) {
      requestAnimationFrame(() => {
        bar.style.transition = `width ${durasi}ms linear`;
        bar.style.width = "100%";
      });
    }
  }

  function jalan() {
    if (reduce) return;
    timer = setInterval(() => tampil((aktif + 1) % LANGKAH.length), durasi);
  }

  tabs.forEach(t => t.addEventListener("click", () => {
    clearInterval(timer);
    timer = null; // berhenti otomatis setelah user memilih sendiri
    tampil(Number(t.dataset.step));
  }));

  jalan();
  tampil(0);
}
