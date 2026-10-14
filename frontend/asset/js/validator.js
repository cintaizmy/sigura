// =========================================================
// Halaman Validator: antrian, detail, validasi + data contoh
// =========================================================

const akun = wajibLogin("validator");

const $ = id => document.getElementById(id);
const NAMA_KEY = "sigurame:nama-validator";
const KATA_MENDESAK = ["mati", "menyebar", "semua ikan", "banyak ikan"];

let tabAktif = "menunggu";
let dipilih = null;
let data = [];            // semua konsultasi dari backend

// ---------------------------------------------------------
// Utilitas
// ---------------------------------------------------------
$("in-diagnosis").innerHTML =
  `<option value="">Pilih diagnosis…</option>` +
  Object.keys(PENYAKIT).map(k => `<option value="${k}">${namaDiagnosis(k)}</option>`).join("") +
  `<option value="lainnya">Penyakit lain (jelaskan di pesan)</option>`;

function namaValidator() { return localStorage.getItem(NAMA_KEY) || akun.nama || ""; }
function sapa() {
  const n = namaValidator();
  $("val-greet").textContent = n ? `Halo, ${n.split(",")[0]}` : "Halo, Validator";
}
$("in-nama").value = namaValidator();
sapa();

const pengguna = r => (r.konsultasi && r.konsultasi.pengguna) || { nama: "Pengguna SiGura", lokasi: "" };
const isMendesak = r => {
  const note = ((r.konsultasi && r.konsultasi.catatanUser) || "").toLowerCase();
  return r.konsultasi && r.konsultasi.status === "menunggu" && KATA_MENDESAK.some(k => note.includes(k));
};

function semuaKonsul() { return data; }

// ---------- Notifikasi konsultasi baru ----------
// Badge angka di menu "Antrian konsultasi" + toast saat ada konsultasi baru yang sudah dibayar.
const LIHAT_KEY = "sigurame:validator-terakhir";
let jumlahSebelum = null;

function notifKonsulBaru() {
  const menunggu = data.filter(r => r.konsultasi.status === "menunggu");
  const link = document.querySelector('.nav-links a[href="validator.html"]');
  if (link) {
    let badge = link.querySelector(".nav-badge");
    if (menunggu.length) {
      if (!badge) { badge = document.createElement("span"); badge.className = "nav-badge"; link.appendChild(badge); }
      badge.textContent = menunggu.length;
      badge.title = `${menunggu.length} konsultasi menunggu validasi`;
    } else if (badge) badge.remove();
  }

  // Konsultasi yang masuk setelah terakhir kali halaman ini dibuka
  let terakhir = "";
  try { terakhir = localStorage.getItem(LIHAT_KEY) || ""; } catch {}
  const baru = menunggu.filter(r => r.konsultasi.dikirim > terakhir).length;
  if (jumlahSebelum === null ? (terakhir && baru) : menunggu.length > jumlahSebelum) {
    toast(jumlahSebelum === null
      ? `${baru} konsultasi baru masuk sejak terakhir kamu buka.`
      : `${menunggu.length - jumlahSebelum} konsultasi baru masuk.`);
  }
  jumlahSebelum = menunggu.length;
  const paling = data.reduce((m, r) => (r.konsultasi.dikirim > m ? r.konsultasi.dikirim : m), terakhir);
  try { localStorage.setItem(LIHAT_KEY, paling); } catch {}
}

async function muat() {
  try {
    data = await api("/api/konsultasi");
    renderQueue();
    notifKonsulBaru();
  } catch (err) {
    $("queue-list").innerHTML = "";
    $("queue-empty").classList.remove("hidden");
    $("queue-empty").textContent = err.message;
  }
}

function waktuRelatif(iso) {
  const menit = Math.round((Date.now() - new Date(iso)) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.round(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
}

function toast(teks) {
  const t = $("val-toast");
  $("val-toast-text").textContent = teks;
  t.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add("hidden"), 3500);
}

// ---------------------------------------------------------
// Statistik
// ---------------------------------------------------------
function renderStats(list) {
  const menunggu = list.filter(r => r.konsultasi.status === "menunggu");
  const selesai = list.filter(r => r.konsultasi.status === "selesai");
  const sesuai = selesai.filter(r => r.konsultasi.diagnosis === r.label).length;

  $("st-menunggu").textContent = menunggu.length;
  $("st-mendesak").textContent = menunggu.filter(isMendesak).length;
  $("st-selesai").textContent = selesai.length;
  $("st-akurasi").textContent = selesai.length ? Math.round((sesuai / selesai.length) * 100) + "%" : "–";
  $("c-menunggu").textContent = menunggu.length;
  $("c-selesai").textContent = selesai.length;
}

// ---------------------------------------------------------
// Antrian
// ---------------------------------------------------------
function renderQueue() {
  const list = semuaKonsul();
  renderStats(list);

  const q = $("q").value.trim().toLowerCase();
  let tampil = list
    .filter(r => r.konsultasi.status === tabAktif)
    .filter(r => {
      if (!q) return true;
      const p = pengguna(r);
      return [p.nama, p.lokasi, r.konsultasi.catatanUser, namaDiagnosis(r.label)].join(" ").toLowerCase().includes(q);
    });

  if (tabAktif === "menunggu") {
    // mendesak dulu, lalu yang paling lama menunggu
    tampil.sort((a, b) =>
      (isMendesak(b) - isMendesak(a)) || (new Date(a.konsultasi.dikirim) - new Date(b.konsultasi.dikirim))
    );
  } else {
    tampil.sort((a, b) => new Date(b.konsultasi.divalidasi) - new Date(a.konsultasi.divalidasi));
  }

  $("queue-empty").classList.toggle("hidden", tampil.length > 0);
  $("queue-empty").textContent = q
    ? "Tidak ada konsultasi yang cocok dengan pencarian."
    : !list.length ? "Belum ada konsultasi masuk. Klik \"Muat data contoh\" untuk mencoba."
    : tabAktif === "menunggu" ? "Semua konsultasi sudah divalidasi. Kerja bagus!" : "Belum ada konsultasi yang divalidasi.";

  $("queue-list").innerHTML = tampil.map(r => {
    const k = r.konsultasi;
    const p = pengguna(r);
    const sehat = r.label === "sehat";
    const status = k.status === "selesai"
      ? `<span class="pill ${k.diagnosis === "sehat" ? "pill-healthy" : "pill-sick"}">${escapeHTML(namaDiagnosis(k.diagnosis))}</span>
         ${k.diagnosis !== r.label ? `<span class="vq-fix">dikoreksi</span>` : ""}`
      : `<span class="pill ${sehat ? "pill-healthy" : "pill-sick"}">${escapeHTML(namaDiagnosis(r.label))} ${Math.round(r.confidence * 100)}%</span>`;
    return `
      <li>
        <button type="button" class="vq-item ${String(r.id) === String(dipilih) ? "active" : ""} ${isMendesak(r) ? "urgent" : ""}" data-id="${r.id}">
          <img src="${k.image || r.image}" alt="">
          <span class="vq-main">
            <span class="vq-top">
              <strong>${escapeHTML(p.nama)}</strong>
              <small>${waktuRelatif(k.status === "selesai" ? k.divalidasi : k.dikirim)}</small>
            </span>
            <span class="vq-tags">${status}${isMendesak(r) ? `<span class="urgent-tag">Mendesak</span>` : ""}</span>
            <small class="vq-note">${k.catatanUser ? escapeHTML(k.catatanUser) : "Tanpa catatan"}</small>
          </span>
        </button>
      </li>`;
  }).join("");
}

// ---------------------------------------------------------
// Detail
// ---------------------------------------------------------
function toggleKeparahan() {
  $("keparahan-field").classList.toggle("hidden", $("in-diagnosis").value === "sehat");
}

function bukaDetail(id) {
  const r = data.find(x => String(x.id) === String(id));
  if (!r || !r.konsultasi) return;
  dipilih = r.id;
  const k = r.konsultasi;
  const p = pengguna(r);
  const sehat = r.label === "sehat";
  const pct = Math.round(r.confidence * 100);

  $("detail-empty").classList.add("hidden");
  const body = $("detail-body");
  body.classList.remove("hidden");
  body.classList.remove("swap"); void body.offsetWidth; body.classList.add("swap");
  $("form-msg").innerHTML = "";

  $("d-avatar").textContent = p.nama.replace(/^(Pak|Bu|Mas|Mbak)\s+/i, "").charAt(0).toUpperCase();
  $("d-nama").textContent = p.nama;
  $("d-lokasi").textContent = p.lokasi ? `Kolam di ${p.lokasi}` : "Lokasi tidak dicantumkan";
  $("d-tanggal").textContent = "Diajukan " + waktuRelatif(k.dikirim);
  $("d-img").src = k.image || r.image;
  $("d-model").textContent = namaDiagnosis(r.label);
  $("d-model").className = sehat ? "text-healthy" : "text-sick";
  $("d-conf").className = "h-conf " + (sehat ? "ok" : "sick");
  $("d-conf-bar").style.width = pct + "%";
  $("d-conf-text").textContent = `${pct}% yakin`;
  $("d-demo").classList.toggle("hidden", !r.demo);
  $("d-urgent").classList.toggle("hidden", !isMendesak(r));
  $("d-note").textContent = k.catatanUser || "Pembudidaya tidak menambahkan catatan.";

  $("in-diagnosis").value = k.diagnosis || "";
  document.querySelectorAll('input[name="keparahan"]').forEach(el => (el.checked = el.value === k.keparahan));
  $("in-pesan").value = k.pesan || "";
  $("btn-kirim").textContent = k.status === "selesai" ? "Perbarui validasi" : "Kirim validasi";
  toggleKeparahan();

  renderQueue();
  if (window.innerWidth < 980) document.querySelector(".val-detail").scrollIntoView({ behavior: "smooth" });
}

function kosongkanDetail() {
  dipilih = null;
  $("detail-body").classList.add("hidden");
  $("detail-empty").classList.remove("hidden");
}

// ---------------------------------------------------------
// Kirim validasi
// ---------------------------------------------------------
async function kirimValidasi(e) {
  e.preventDefault();
  const diagnosis = $("in-diagnosis").value;
  const kep = document.querySelector('input[name="keparahan"]:checked');
  const pesan = $("in-pesan").value.trim();
  const nama = $("in-nama").value.trim();
  const sehat = diagnosis === "sehat";

  const kurang = [];
  if (!diagnosis) kurang.push("diagnosis");
  if (!sehat && !kep) kurang.push("tingkat keparahan");
  if (!pesan) kurang.push("rekomendasi penanganan");
  if (!nama) kurang.push("nama validator");
  if (kurang.length) {
    $("form-msg").innerHTML = `<div class="alert alert-error">Lengkapi dulu: ${kurang.join(", ")}.</div>`;
    return;
  }

  localStorage.setItem(NAMA_KEY, nama);
  sapa();

  const btn = $("btn-kirim");
  const labelAsli = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Mengirim…";
  let r;
  try {
    r = await api(`/api/scans/${dipilih}/validasi`, {
      method: "PUT",
      body: { diagnosis, keparahan: sehat ? null : kep.value, pesan, validator_nama: nama }
    });
  } catch (err) {
    $("form-msg").innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
    btn.disabled = false;
    btn.textContent = labelAsli;
    return;
  }
  btn.disabled = false;
  data = data.map(x => (x.id === r.id ? r : x));

  toast(`Validasi untuk ${pengguna(r).nama} terkirim.`);

  const berikutnya = semuaKonsul()
    .filter(x => x.konsultasi.status === "menunggu")
    .sort((a, b) => (isMendesak(b) - isMendesak(a)) || (new Date(a.konsultasi.dikirim) - new Date(b.konsultasi.dikirim)))[0];

  if (tabAktif === "menunggu" && berikutnya) bukaDetail(berikutnya.id);
  else if (tabAktif === "menunggu") { kosongkanDetail(); renderQueue(); }
  else bukaDetail(dipilih);
}

// ---------------------------------------------------------
// Event
// ---------------------------------------------------------
document.querySelectorAll(".val-tabs button").forEach(btn =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".val-tabs button").forEach(b => b.classList.toggle("active", b === btn));
    tabAktif = btn.dataset.tab;
    kosongkanDetail();
    renderQueue();
  })
);

$("queue-list").addEventListener("click", e => {
  const item = e.target.closest(".vq-item");
  if (item) bukaDetail(item.dataset.id);
});

$("q").addEventListener("input", renderQueue);
$("in-diagnosis").addEventListener("change", toggleKeparahan);

$("btn-setuju").addEventListener("click", () => {
  const r = data.find(x => String(x.id) === String(dipilih));
  if (!r) return;
  $("in-diagnosis").value = r.label;
  toggleKeparahan();
  if (!$("in-pesan").value.trim() && PENYAKIT[r.label]) {
    $("in-pesan").value = PENYAKIT[r.label].penanganan.map((t, i) => `${i + 1}. ${t}`).join("\n");
  }
  $("form-msg").innerHTML = "";
});

$("btn-template").addEventListener("click", () => {
  const d = $("in-diagnosis").value;
  if (!PENYAKIT[d]) {
    $("form-msg").innerHTML = `<div class="alert alert-error">Pilih diagnosis dulu untuk memakai saran standar.</div>`;
    return;
  }
  $("in-pesan").value = PENYAKIT[d].penanganan.map((t, i) => `${i + 1}. ${t}`).join("\n");
  $("form-msg").innerHTML = "";
});

$("btn-seed").addEventListener("click", async () => {
  if (!confirm("Muat 5 data contoh? Data contoh lama akan diganti, konsultasi asli tidak terhapus.")) return;
  try {
    await api("/api/dev/seed", { method: "POST" });
    kosongkanDetail();
    await muat();
    toast("Data contoh dimuat.");
  } catch (err) {
    toast(err.message);
  }
});

$("validasi-form").addEventListener("submit", kirimValidasi);

// Cek konsultasi baru tiap 30 detik
setInterval(muat, 30000);

muat();
