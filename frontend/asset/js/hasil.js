// =========================================================
// Halaman Hasil: hasil scan, checklist penanganan, konsultasi
// URL: hasil.html?id=<id scan>  (data diambil dari backend)
// =========================================================

wajibLogin();

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
let entry = null;

// ---------- Hasil model ----------
function renderHasil(data) {
  const info = PENYAKIT[data.label];
  const sehat = data.label === "sehat";
  const pct = Math.round(data.confidence * 100);

  $("result").classList.remove("hidden");
  $("result-img").src = data.image;
  $("result-date").textContent = "Discan " + formatTanggal(data.tanggal);
  $("demo-badge").classList.toggle("hidden", !data.demo);

  $("status").classList.add(sehat ? "is-healthy" : "is-sick");
  $("status-title").textContent = sehat ? "Ikan sehat" : "Terindikasi " + info.nama.toLowerCase();
  $("summary").textContent = info.ringkasan;

  // Gauge keyakinan (animasi dari 0)
  const keliling = 2 * Math.PI * 52;
  const fg = $("gauge-fg");
  fg.style.strokeDasharray = keliling;
  fg.style.strokeDashoffset = keliling;
  requestAnimationFrame(() => setTimeout(() => {
    fg.style.strokeDashoffset = keliling * (1 - data.confidence);
  }, 150));
  animasiAngka($("conf-text"), pct);
  $("gauge").setAttribute("aria-label", `Keyakinan model ${pct}%`);
  $("conf-desc").textContent =
    pct >= 85 ? "Model sangat yakin dengan hasil ini." :
    pct >= 65 ? "Model cukup yakin. Cocokkan juga dengan gejala di kolam." :
    "Model kurang yakin. Coba foto ulang atau minta konsultasi lanjutan.";

  if (sehat) {
    $("block-gejala").classList.add("hidden");
    $("tab-penanganan").textContent = "Tips perawatan";
    $("saran-title").textContent = "Tips menjaga ikan tetap sehat";
    $("detail-link").textContent = "Kenali penyakit gurame";
  } else {
    $("gejala").innerHTML = info.gejala.map(g => `<li>${escapeHTML(g)}</li>`).join("");
    $("detail-link").href = "penyakit.html#" + data.label;
  }

  renderJenis(info);
  renderTodo(data.id, info.penanganan);
}

// ---------- Jenis penyakit dalam kelas ----------
// Model hanya membedakan 3 kelas (sehat, bakteri, jamur). Di sini ditampilkan
// jenis-jenis penyakit yang termasuk kelas tersebut agar pengguna bisa mencocokkan.
function renderJenis(info) {
  if (!info.jenis || !info.jenis.length) return;
  $("jenis-chips").classList.remove("hidden");
  $("jenis-chips").innerHTML = `<span>Termasuk:</span>` +
    info.jenis.map((j, i) => `<button type="button" data-jenis="${i}">${escapeHTML(j.nama)}</button>`).join("");
  $("jenis-intro").textContent =
    `Model mendeteksi kelompok ${info.nama.toLowerCase()}, tapi belum bisa membedakan jenisnya. ` +
    `Cocokkan ciri berikut dengan kondisi ikanmu, atau ajukan konsultasi agar penyuluh memastikan.`;
  $("jenis-list").innerHTML = info.jenis.map((j, i) => `
    <article class="jenis-item" id="jenis-${i}">
      <h3>${escapeHTML(j.nama)}</h3>
      <p class="latin">${escapeHTML(j.latin)}</p>
      <p>${escapeHTML(j.ciri)}</p>
    </article>`).join("");
  $("tab-jenis").classList.remove("hidden");
  bukaTab("jenis");

  $("jenis-chips").addEventListener("click", e => {
    const b = e.target.closest("[data-jenis]");
    if (!b) return;
    bukaTab("jenis");
    const el = $("jenis-" + b.dataset.jenis);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ boxShadow: "0 0 0 3px var(--teal)" }, { boxShadow: "0 0 0 0 transparent" }], 1400);
  });
}

function animasiAngka(el, target) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { el.textContent = target + "%"; return; }
  const mulai = performance.now();
  const durasi = 900;
  (function tick(now) {
    const t = Math.min(1, (now - mulai) / durasi);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))) + "%";
    if (t < 1) requestAnimationFrame(tick);
  })(mulai);
}

// ---------- Checklist penanganan ----------
// Centang disimpan di browser saja (catatan pribadi pengguna)
function renderTodo(id, langkah) {
  const key = "sigurame:cek:" + id;
  let cek = [];
  try { cek = JSON.parse(localStorage.getItem(key)) || []; } catch {}

  const ul = $("penanganan");
  ul.innerHTML = langkah.map((t, i) => `
    <li>
      <label>
        <input type="checkbox" data-i="${i}" ${cek.includes(i) ? "checked" : ""}>
        <span class="box" aria-hidden="true"></span>
        <span class="txt">${escapeHTML(t)}</span>
      </label>
    </li>`).join("");

  function updateProgress() {
    const done = ul.querySelectorAll("input:checked").length;
    $("todo-bar").style.width = (done / langkah.length) * 100 + "%";
    $("todo-text").textContent = done === langkah.length
      ? "Semua langkah sudah dilakukan"
      : `${done} dari ${langkah.length} langkah selesai`;
  }

  ul.addEventListener("change", () => {
    const now = [...ul.querySelectorAll("input:checked")].map(el => Number(el.dataset.i));
    try { localStorage.setItem(key, JSON.stringify(now)); } catch {}
    updateProgress();
  });
  updateProgress();
}

// ---------- Tab ----------
function bukaTab(nama) {
  document.querySelectorAll("#result-tabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === nama);
    b.setAttribute("aria-selected", b.dataset.tab === nama);
  });
  document.querySelectorAll(".tab-panel").forEach(p =>
    p.classList.toggle("hidden", p.dataset.panel !== nama)
  );
}
document.querySelectorAll("#result-tabs button").forEach(btn =>
  btn.addEventListener("click", () => bukaTab(btn.dataset.tab))
);

// ---------- Konsultasi lanjutan + pembayaran ----------
// Alur sesuai Flowmap Pengajuan Validasi dan Pembayaran (SRS):
// ajukan validasi (info layanan + konfirmasi) -> pilih metode -> sistem buat transaksi
// -> payment gateway -> berhasil? (gagal: coba lagi) -> menunggu validasi -> hasil validasi
function infoBayar(p) {
  return p && p.status === "lunas"
    ? `Pembayaran lunas: ${rupiah(p.jumlah)} via ${p.metode} (${p.kode})`
    : "";
}

function renderBayar(data) {
  const p = data.pembayaran;
  const diGateway = p && p.status === "menunggu";
  document.querySelectorAll(".pay-total").forEach(el => (el.textContent = rupiah(p ? p.jumlah : tarif.jumlah)));
  $("pay-pilih").classList.toggle("hidden", diGateway);
  $("pay-gateway").classList.toggle("hidden", !diGateway);
  $("pay-gagal").classList.toggle("hidden", !(p && p.status === "gagal"));
  if (p && p.status === "gagal") {
    $("pay-gagal").textContent = `Pembayaran gagal (${p.kode}). Silakan pilih metode dan coba lagi.`;
  }
  if (diGateway) {
    $("pay-kode").textContent = p.kode;
    $("pay-metode").textContent = p.metode;
  }
}

function renderKonsul(data) {
  const k = data.konsultasi;
  const status = k ? k.status : "belum";
  $("konsul-belum").classList.toggle("hidden", status !== "belum");
  $("konsul-bayar").classList.toggle("hidden", status !== "menunggu_bayar");
  $("konsul-menunggu").classList.toggle("hidden", status !== "menunggu");
  $("konsul-selesai").classList.toggle("hidden", status !== "selesai");
  $("konsul").classList.toggle("is-done", status === "selesai");

  if (!k) return;

  if (status === "menunggu_bayar") {
    renderBayar(data);
    return;
  }

  if (status === "menunggu") {
    $("konsul-sent").textContent = "Diteruskan ke validator " + formatTanggal(k.dikirim);
    $("konsul-lunas").textContent = infoBayar(data.pembayaran);
    return;
  }

  $("v-bayar").textContent = infoBayar(data.pembayaran);

  const sehat = k.diagnosis === "sehat";
  $("v-diagnosis").textContent = namaDiagnosis(k.diagnosis);
  $("v-keparahan").textContent = KEPARAHAN[k.keparahan] || "-";
  $("v-keparahan").classList.toggle("hidden", sehat);
  $("v-keparahan-label").classList.toggle("hidden", sehat);
  $("v-nama").textContent = k.validator || "Validator";
  $("v-pesan").textContent = k.pesan;
  $("v-tanggal").textContent = "Divalidasi " + formatTanggal(k.divalidasi);

  if (PENYAKIT[k.diagnosis] && !sehat) $("detail-link").href = "penyakit.html#" + k.diagnosis;

  const dikoreksi = k.diagnosis !== data.label;
  $("v-koreksi").classList.toggle("hidden", !dikoreksi);
  if (dikoreksi) {
    $("v-koreksi").textContent =
      `Validator mengoreksi hasil model: dari "${namaDiagnosis(data.label)}" menjadi "${namaDiagnosis(k.diagnosis)}". Ikuti saran dari validator.`;
  }

  // Tandai balasan sudah dibaca
  if (!k.dibaca) {
    k.dibaca = true;
    api(`/api/scans/${data.id}/dibaca`, { method: "PATCH" })
      .then(() => refreshNotif())
      .catch(() => {});
  }
}

// Info layanan dari backend (harga, estimasi waktu, ketentuan)
let tarif = { jumlah: 25000 };
async function muatTarif() {
  try {
    tarif = await api("/api/tarif");
    $("tarif-text").textContent = rupiah(tarif.jumlah);
    $("estimasi-text").textContent = tarif.estimasi;
    $("ketentuan-list").innerHTML = tarif.ketentuan.map(t => `<li>${escapeHTML(t)}</li>`).join("");
  } catch {}
}

// Langkah 1: konfirmasi pengajuan validasi
async function kirimKonsul(e) {
  e.preventDefault();
  if (!$("konsul-setuju").checked) {
    $("konsul-msg").innerHTML = `<div class="alert alert-error">Centang persetujuan ketentuan layanan dulu.</div>`;
    return;
  }
  const btn = $("konsul-form").querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "Memproses…";
  try {
    entry = await api(`/api/scans/${entry.id}/konsultasi`, {
      method: "POST", body: { catatan: $("konsul-note").value.trim() }
    });
    renderKonsul(entry);
  } catch (err) {
    $("konsul-msg").innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Konfirmasi pengajuan";
  }
}

// Langkah 2: pilih metode -> sistem membuat transaksi
async function lanjutBayar() {
  const pilih = document.querySelector('input[name="metode"]:checked');
  if (!pilih) {
    $("pay-msg").innerHTML = `<div class="alert alert-error">Pilih metode pembayaran dulu.</div>`;
    return;
  }
  $("pay-msg").innerHTML = "";
  const btn = $("btn-lanjut-bayar");
  btn.disabled = true;
  try {
    entry = await api(`/api/scans/${entry.id}/transaksi`, { method: "POST", body: { metode: pilih.value } });
    renderKonsul(entry);
  } catch (err) {
    $("pay-msg").innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// Langkah 3: payment gateway (simulasi) -> berhasil / gagal
async function prosesBayar(hasil) {
  const ok = $("btn-bayar-ok"), gagal = $("btn-bayar-gagal");
  ok.disabled = gagal.disabled = true;
  ok.textContent = "Memproses pembayaran…";
  try {
    const [res] = await Promise.all([
      api(`/api/scans/${entry.id}/bayar`, { method: "POST", body: { hasil } }),
      new Promise(r => setTimeout(r, 1200)) // jeda supaya terasa seperti proses di gateway
    ]);
    entry = res;
    renderKonsul(entry);
  } catch (err) {
    alert(err.message);
  } finally {
    ok.disabled = gagal.disabled = false;
    ok.textContent = "Bayar";
  }
}

function pasangEvent() {
  muatTarif();
  $("btn-konsul").addEventListener("click", () => {
    $("btn-konsul").classList.add("hidden");
    $("konsul-form").classList.remove("hidden");
    $("konsul-note").focus();
  });
  $("btn-konsul-batal").addEventListener("click", () => {
    $("konsul-form").classList.add("hidden");
    $("btn-konsul").classList.remove("hidden");
    $("konsul-msg").innerHTML = "";
  });
  $("konsul-setuju").addEventListener("change", () => ($("konsul-msg").innerHTML = ""));
  $("konsul-form").addEventListener("submit", kirimKonsul);
  $("btn-lanjut-bayar").addEventListener("click", lanjutBayar);
  $("btn-bayar-ok").addEventListener("click", () => prosesBayar("berhasil"));
  $("btn-bayar-gagal").addEventListener("click", () => prosesBayar("gagal"));
  document.querySelectorAll('input[name="metode"]').forEach(r =>
    r.addEventListener("change", () => ($("pay-msg").innerHTML = ""))
  );

  // Hitung karakter catatan
  $("konsul-note").addEventListener("input", e => {
    $("note-count").textContent = `${e.target.value.length}/500`;
  });

  // Tag cepat: klik untuk menambahkan ke catatan
  $("quick-tags").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const note = $("konsul-note");
    const teks = btn.textContent;
    if (!note.value.includes(teks)) {
      note.value = (note.value.trim() ? note.value.trim() + ". " : "") + teks;
      btn.classList.add("used");
      note.dispatchEvent(new Event("input"));
    }
  });

  // Selama menunggu validator, cek balasan tiap 30 detik
  setInterval(async () => {
    if (!entry.konsultasi || entry.konsultasi.status !== "menunggu") return;
    try {
      entry = await api("/api/scans/" + entry.id);
      renderKonsul(entry);
    } catch {}
  }, 30000);
}

// ---------- Mulai ----------
(async function mulai() {
  const id = params.get("id");
  try {
    entry = id ? await api("/api/scans/" + encodeURIComponent(id)) : null;
  } catch (err) {
    entry = null;
    $("no-result").querySelector("p").textContent = err.message;
  }

  if (!entry || !PENYAKIT[entry.label]) {
    $("no-result").classList.remove("hidden");
    return;
  }
  renderHasil(entry);
  renderKonsul(entry);
  pasangEvent();
})();
