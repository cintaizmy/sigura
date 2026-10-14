// =========================================================
// Halaman Admin: kelola pengguna, lihat pemeriksaan & transaksi
// =========================================================

const akun = wajibLogin("admin");

const $ = id => document.getElementById(id);
let users = [];
let scans = [];
let transaksi = [];

const tgl = iso => iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
const jamTgl = iso => iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
const kosong = (kolom, teks) => `<tr><td colspan="${kolom}" class="adm-empty">${teks}</td></tr>`;

function toast(teks) {
  $("adm-toast-text").textContent = teks;
  $("adm-toast").classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $("adm-toast").classList.add("hidden"), 3500);
}

$("adm-greet").textContent = "Halo, " + akun.nama.split(",")[0];

// ---------- Tab ----------
$("adm-tabs").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  $("adm-tabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll("[data-panel]").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== btn.dataset.tab));
});

// ---------- Ringkasan ----------
async function muatRingkasan() {
  const r = await api("/api/admin/ringkasan");
  $("st-pembudidaya").textContent = r.pembudidaya;
  $("st-menunggu").textContent = r.konsultasi_menunggu;
  $("st-pemeriksaan").textContent = r.pemeriksaan;
  $("st-pendapatan").textContent = rupiah(r.pendapatan);
  $("adm-model").textContent = r.model === "demo"
    ? "Model: mode demo (belum dipasang)"
    : `Model aktif: ${r.model === "pytorch" ? "PyTorch (uji coba)" : "Keras"}`;
}

// ---------- Pengguna ----------
function renderUsers() {
  const q = $("q-user").value.trim().toLowerCase();
  const role = $("f-role").value;
  const list = users
    .filter(u => !role || u.role === role)
    .filter(u => !q || (u.nama + " " + u.email).toLowerCase().includes(q));
  $("c-pengguna").textContent = users.filter(u => !u.contoh).length;

  $("tb-pengguna").innerHTML = list.length ? list.map(u => {
    const diriSendiri = u.id === akun.id;
    return `
      <tr>
        <td><strong>${escapeHTML(u.nama)}</strong>${u.contoh ? ` <span class="h-demo">contoh</span>` : ""}
          ${u.lokasi ? `<div class="muted">${escapeHTML(u.lokasi)}</div>` : ""}</td>
        <td class="muted">${escapeHTML(u.email)}</td>
        <td>${diriSendiri
          ? `<span class="role-tag admin">admin (kamu)</span>`
          : `<select data-role="${u.id}" aria-label="Role ${escapeHTML(u.nama)}">
              ${["pembudidaya", "validator", "admin"].map(r => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
            </select>`}</td>
        <td>${u.jumlah_scan}</td>
        <td>${u.role === "validator" ? u.jumlah_validasi : "-"}</td>
        <td class="muted">${tgl(u.created_at)}</td>
        <td>${diriSendiri ? "" : `<button type="button" class="link-btn danger" data-hapus="${u.id}">Hapus</button>`}</td>
      </tr>`;
  }).join("") : kosong(7, "Tidak ada akun yang cocok.");
}

async function muatUsers() {
  users = await api("/api/admin/users");
  renderUsers();
}

$("q-user").addEventListener("input", renderUsers);
$("f-role").addEventListener("change", renderUsers);

$("tb-pengguna").addEventListener("change", async e => {
  const sel = e.target.closest("[data-role]");
  if (!sel) return;
  const u = users.find(x => x.id === Number(sel.dataset.role));
  try {
    await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role: sel.value } });
    u.role = sel.value;
    toast(`Role ${u.nama} diubah jadi ${sel.value}.`);
    muatRingkasan();
  } catch (err) {
    toast(err.message);
    sel.value = u.role;
  }
});

$("tb-pengguna").addEventListener("click", async e => {
  const btn = e.target.closest("[data-hapus]");
  if (!btn) return;
  const u = users.find(x => x.id === Number(btn.dataset.hapus));
  if (!confirm(`Hapus akun ${u.nama}? Semua hasil scan milik akun ini ikut terhapus.`)) return;
  try {
    await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
    toast(`Akun ${u.nama} dihapus.`);
    muatSemua();
  } catch (err) {
    toast(err.message);
  }
});

// Tambah akun (validator / admin / pembudidaya)
$("btn-tambah").addEventListener("click", () => {
  $("form-tambah").classList.toggle("hidden");
  $("u-nama").focus();
});
$("btn-batal").addEventListener("click", () => {
  $("form-tambah").reset();
  $("form-tambah").classList.add("hidden");
  $("form-msg").innerHTML = "";
});
$("form-tambah").addEventListener("submit", async e => {
  e.preventDefault();
  const body = {
    nama: $("u-nama").value.trim(),
    email: $("u-email").value.trim(),
    password: $("u-pass").value,
    role: $("u-role").value,
    lokasi: $("u-lokasi").value.trim()
  };
  if (!body.nama || !body.email || !body.password) {
    $("form-msg").innerHTML = `<div class="alert alert-error">Lengkapi nama, email, dan kata sandi.</div>`;
    return;
  }
  try {
    await api("/api/admin/users", { method: "POST", body });
    toast(`Akun ${body.role} untuk ${body.nama} dibuat.`);
    $("form-tambah").reset();
    $("form-tambah").classList.add("hidden");
    $("form-msg").innerHTML = "";
    muatSemua();
  } catch (err) {
    $("form-msg").innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
});

// ---------- Pemeriksaan ----------
$("f-label").innerHTML = `<option value="">Semua hasil</option>` +
  KELAS_SCAN.map(k => `<option value="${k}">${namaDiagnosis(k)}</option>`).join("");

function statusKonsul(s) {
  if (!s.konsultasi) return `<span class="muted">-</span>`;
  const k = s.konsultasi.status;
  if (k === "menunggu_bayar") return `<span class="pay-tag menunggu">Belum bayar</span>`;
  if (k === "menunggu") return `<span class="pay-tag menunggu">Menunggu validator</span>`;
  return `<span class="pay-tag lunas">Selesai</span>`;
}

function renderScans() {
  const q = $("q-scan").value.trim().toLowerCase();
  const label = $("f-label").value;
  const list = scans
    .filter(s => !label || s.label === label)
    .filter(s => !q || s.pengguna.nama.toLowerCase().includes(q));
  $("c-pemeriksaan").textContent = scans.length;

  const hitung = {};
  scans.forEach(s => (hitung[s.label] = (hitung[s.label] || 0) + 1));
  $("sum-label").innerHTML = KELAS_SCAN.map(k => `<span>${namaDiagnosis(k)} <strong>${hitung[k] || 0}</strong></span>`).join("");

  $("tb-pemeriksaan").innerHTML = list.length ? list.map(s => `
    <tr>
      <td><a href="${s.image}" target="_blank" rel="noopener"><img src="${s.image}" alt="Foto scan"></a></td>
      <td><strong>${escapeHTML(s.pengguna.nama)}</strong><div class="muted">${escapeHTML(s.pengguna.email || "")}</div></td>
      <td><span class="pill ${s.label === "sehat" ? "pill-healthy" : "pill-sick"}">${escapeHTML(namaDiagnosis(s.label))}</span>
        ${s.demo ? ` <span class="h-demo">demo</span>` : ""}</td>
      <td>${Math.round(s.confidence * 100)}%</td>
      <td class="muted">${jamTgl(s.tanggal)}</td>
      <td>${statusKonsul(s)}</td>
      <td>${s.konsultasi && s.konsultasi.diagnosis
        ? `${escapeHTML(namaDiagnosis(s.konsultasi.diagnosis))}${s.konsultasi.diagnosis !== s.label ? ` <span class="muted">(dikoreksi)</span>` : ""}`
        : `<span class="muted">-</span>`}</td>
    </tr>`).join("") : kosong(7, "Belum ada pemeriksaan.");
}

async function muatScans() {
  scans = await api("/api/admin/pemeriksaan");
  renderScans();
}

$("q-scan").addEventListener("input", renderScans);
$("f-label").addEventListener("change", renderScans);

// ---------- Transaksi ----------
function renderTransaksi() {
  $("c-transaksi").textContent = transaksi.length;
  const lunas = transaksi.filter(t => t.pembayaran.status === "lunas");
  $("sum-transaksi").innerHTML = `
    <span>Lunas <strong>${lunas.length}</strong></span>
    <span>Menunggu/gagal <strong>${transaksi.length - lunas.length}</strong></span>
    <span>Total diterima <strong>${rupiah(lunas.reduce((a, t) => a + t.pembayaran.jumlah, 0))}</strong></span>`;

  $("tb-transaksi").innerHTML = transaksi.length ? transaksi.map(t => {
    const p = t.pembayaran;
    return `
      <tr>
        <td><strong>${escapeHTML(p.kode)}</strong></td>
        <td>${escapeHTML(t.pengguna.nama)}</td>
        <td>${rupiah(p.jumlah)}</td>
        <td>${p.metode ? escapeHTML(p.metode) : `<span class="muted">-</span>`}</td>
        <td><span class="pay-tag ${p.status}">${STATUS_BAYAR[p.status] || p.status}</span></td>
        <td class="muted">${jamTgl(p.dibuat)}</td>
        <td class="muted">${jamTgl(p.dibayar)}</td>
      </tr>`;
  }).join("") : kosong(7, "Belum ada transaksi.");
}

async function muatTransaksi() {
  transaksi = await api("/api/admin/transaksi");
  renderTransaksi();
}

// ---------- Mulai ----------
async function muatSemua() {
  try {
    await Promise.all([muatRingkasan(), muatUsers(), muatScans(), muatTransaksi()]);
  } catch (err) {
    toast(err.message);
  }
}

muatSemua();
setInterval(muatSemua, 60000);
