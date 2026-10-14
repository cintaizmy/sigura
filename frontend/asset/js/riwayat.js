// =========================================================
// Halaman Riwayat: ringkasan, filter, grup per tanggal,
// status konsultasi, hapus dengan urungkan
// =========================================================

wajibLogin();

const $ = id => document.getElementById(id);
let semua = [];           // data dari backend
let filterAktif = "all";
let terhapus = null;      // { entry, index } menunggu dihapus (bisa diurungkan)
let undoTimer = null;

const isBaru = r => r.konsultasi && r.konsultasi.status === "selesai" && !r.konsultasi.dibaca;
const isSehat = r => r.label === "sehat";
const belumBayar = r => r.konsultasi && r.konsultasi.status === "menunggu_bayar";

const FILTER = [
  { key: "all", label: "Semua", fn: () => true },
  { key: "sehat", label: "Sehat", fn: isSehat },
  { key: "sakit", label: "Terindikasi", fn: r => !isSehat(r) },
  { key: "konsul", label: "Konsultasi", fn: r => !!r.konsultasi },
  { key: "baru", label: "Balasan baru", fn: isBaru }
];

// ---------- Ringkasan ----------
function renderStats(all) {
  const set = (id, n) => ($(id).textContent = n);
  set("st-total", all.length);
  set("st-sehat", all.filter(isSehat).length);
  set("st-sakit", all.filter(r => !isSehat(r)).length);
  set("st-tunggu", all.filter(r => r.konsultasi && r.konsultasi.status === "menunggu").length);
}

// ---------- Filter ----------
function renderFilter(all) {
  $("filter").innerHTML = FILTER.map(f => {
    const n = all.filter(f.fn).length;
    if (f.key === "baru" && n === 0 && filterAktif !== "baru") return "";
    return `
      <button type="button" role="radio" data-f="${f.key}"
        aria-checked="${f.key === filterAktif}" class="${f.key === filterAktif ? "active" : ""} ${f.key === "baru" ? "is-alert" : ""}">
        ${f.label}<span>${n}</span>
      </button>`;
  }).join("");
}

$("filter").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  filterAktif = btn.dataset.f;
  render();
});

// ---------- Grup per tanggal ----------
function labelTanggal(iso) {
  const d = new Date(iso);
  const hari = new Date(); hari.setHours(0, 0, 0, 0);
  const tgl = new Date(d); tgl.setHours(0, 0, 0, 0);
  const selisih = Math.round((hari - tgl) / 86400000);
  if (selisih === 0) return "Hari ini";
  if (selisih === 1) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function jam(iso) {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function statusKonsul(r) {
  const k = r.konsultasi;
  if (!k) return "";
  if (k.status === "menunggu_bayar") {
    const gagal = r.pembayaran && r.pembayaran.status === "gagal";
    return `<p class="h-konsul ${gagal ? "sick" : "wait"}">${gagal ? "Pembayaran gagal, silakan coba lagi" : "Validasi belum dibayar"}</p>`;
  }
  if (k.status === "menunggu") {
    return `<p class="h-konsul wait"><span class="pulse"></span>Menunggu validasi penyuluh</p>`;
  }
  const sakit = k.diagnosis !== "sehat";
  return `<p class="h-konsul ${sakit ? "sick" : "ok"}">
    Validator: <strong>${escapeHTML(namaDiagnosis(k.diagnosis))}</strong>
    ${isBaru(r) ? `<span class="new-tag">Baru</span>` : ""}
  </p>`;
}

function itemHTML(r) {
  const sehat = isSehat(r);
  const pct = Math.round(r.confidence * 100);
  return `
    <article class="h-item ${isBaru(r) ? "is-new" : ""}" data-id="${r.id}">
      <a href="hasil.html?id=${r.id}" class="h-thumb" tabindex="-1" aria-hidden="true">
        <img src="${r.image}" alt="">
      </a>
      <div class="h-main">
        <div class="h-top">
          <span class="pill ${sehat ? "pill-healthy" : "pill-sick"}">${escapeHTML(namaDiagnosis(r.label))}</span>
          <span class="h-time">${jam(r.tanggal)}</span>
          ${r.demo ? `<span class="h-demo">demo</span>` : ""}
        </div>
        <div class="h-conf ${sehat ? "ok" : "sick"}">
          <div class="bar"><span style="width:${pct}%"></span></div>
          <span>${pct}%</span>
        </div>
        ${statusKonsul(r)}
      </div>
      <div class="h-actions">
        <a href="hasil.html?id=${r.id}" class="btn ${isBaru(r) || belumBayar(r) ? "btn-primary" : "btn-outline"} btn-sm">${isBaru(r) ? "Baca balasan" : belumBayar(r) ? "Bayar" : "Lihat"}</a>
        <button type="button" class="icon-btn" data-del="${r.id}" aria-label="Hapus riwayat ini">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </article>`;
}

// ---------- Render ----------
function render() {
  const all = semua;
  const ada = all.length > 0;

  renderStats(all);
  $("toolbar").classList.toggle("hidden", !ada);
  $("empty").classList.toggle("hidden", ada);
  $("history-list").classList.toggle("hidden", !ada);
  if (!ada) { $("filter-empty").classList.add("hidden"); return; }

  if (!FILTER.some(f => f.key === filterAktif)) filterAktif = "all";
  renderFilter(all);

  const fn = FILTER.find(f => f.key === filterAktif).fn;
  let list = all.filter(fn).sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
  if ($("sort").value === "lama") list.reverse();

  $("filter-empty").classList.toggle("hidden", list.length > 0);

  // Kelompokkan per tanggal
  const grup = [];
  list.forEach(r => {
    const label = labelTanggal(r.tanggal);
    const last = grup[grup.length - 1];
    if (last && last.label === label) last.items.push(r);
    else grup.push({ label, items: [r] });
  });

  $("history-list").innerHTML = grup.map(g => `
    <section class="h-group">
      <h2>${g.label} <span>${g.items.length} scan</span></h2>
      <div class="h-items">${g.items.map(itemHTML).join("")}</div>
    </section>`).join("");
}

// ---------- Ambil data dari backend ----------
async function muat() {
  try {
    semua = await api("/api/scans");
    if (terhapus) semua = semua.filter(r => r.id !== terhapus.entry.id);
    render();
  } catch (err) {
    $("history-list").classList.remove("hidden");
    $("history-list").innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

// ---------- Hapus + urungkan ----------
// Item langsung hilang dari layar, tapi baru dihapus di server
// setelah 6 detik, supaya tombol "Urungkan" masih bisa dipakai.
function hapus(id) {
  if (terhapus) komitHapus();
  const index = semua.findIndex(r => String(r.id) === String(id));
  if (index === -1) return;

  const el = document.querySelector(`.h-item[data-id="${id}"]`);
  const lanjut = () => {
    terhapus = { entry: semua[index], index };
    semua.splice(index, 1);
    render();
    tampilUndo();
  };

  if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.classList.add("removing");
    setTimeout(lanjut, 250);
  } else {
    lanjut();
  }
}

async function komitHapus(keepalive = false) {
  if (!terhapus) return;
  const { entry } = terhapus;
  terhapus = null;
  clearTimeout(undoTimer);
  $("undo-toast").classList.add("hidden");
  try {
    await api(`/api/scans/${entry.id}`, { method: "DELETE", keepalive });
    refreshNotif();
  } catch (err) {
    if (!keepalive) { alert(err.message); muat(); }
  }
}

function tampilUndo() {
  const t = $("undo-toast");
  t.classList.remove("hidden");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => komitHapus(), 6000);
}

$("btn-undo").addEventListener("click", () => {
  if (!terhapus) return;
  clearTimeout(undoTimer);
  semua.splice(terhapus.index, 0, terhapus.entry);
  terhapus = null;
  $("undo-toast").classList.add("hidden");
  render();
});

// Kalau halaman ditutup sebelum 6 detik, tetap hapus
window.addEventListener("pagehide", () => komitHapus(true));

$("history-list").addEventListener("click", e => {
  const btn = e.target.closest("[data-del]");
  if (btn) hapus(btn.dataset.del);
});

$("btn-clear").addEventListener("click", async () => {
  if (!confirm("Hapus semua riwayat scan? Tindakan ini tidak bisa dibatalkan.")) return;
  terhapus = null;
  clearTimeout(undoTimer);
  $("undo-toast").classList.add("hidden");
  try {
    await api("/api/scans", { method: "DELETE" });
    semua = [];
    render();
    refreshNotif();
  } catch (err) {
    alert(err.message);
  }
});

$("sort").addEventListener("change", render);

// Cek balasan validator baru tiap 30 detik
setInterval(muat, 30000);

$("history-list").innerHTML = `<p class="muted">Memuat riwayat…</p>`;
muat();
