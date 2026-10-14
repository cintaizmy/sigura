// =========================================================
// Halaman Profil: lihat & ubah profil, ganti kata sandi,
// riwayat validasi (khusus validator). Dipakai semua role.
// =========================================================

let akun = wajibLogin();
const $ = id => document.getElementById(id);
let riwayat = [];

function toast(teks) {
  $("pf-toast-text").textContent = teks;
  $("pf-toast").classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $("pf-toast").classList.add("hidden"), 3500);
}

const tgl = iso => iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";
const NAMA_ROLE = { pembudidaya: "Pembudidaya", validator: "Validator", admin: "Admin" };

// ---------- Navbar sesuai role ----------
function buatNavbar() {
  const role = akun.role;
  const links = {
    pembudidaya: [["index.html", "Beranda"], ["scan.html", "Scan"], ["penyakit.html", "Penyakit"], ["riwayat.html", "Riwayat"], ["tentang.html", "Tentang"]],
    validator: [["validator.html", "Antrian konsultasi"], ["penyakit.html", "Ensiklopedia"]],
    admin: [["admin.html", "Panel admin"], ["penyakit.html", "Ensiklopedia"]]
  }[role] || [];
  if (role !== "pembudidaya") {
    $("pf-navbar").classList.add("navbar-validator");
    $("pf-brand").href = role === "admin" ? "admin.html" : "validator.html";
    $("pf-brand").insertAdjacentHTML("beforeend", `<small class="brand-tag">${NAMA_ROLE[role]}</small>`);
    document.body.dataset.role = "validator"; // tidak perlu notifikasi pembudidaya
  }
  $("pf-links").innerHTML =
    links.map(([href, teks]) => `<li><a href="${href}">${teks}</a></li>`).join("") +
    `<li><a href="profil.html" class="active">Profil</a></li>` +
    `<li><a href="#" class="btn btn-outline" id="pf-keluar">Keluar</a></li>`;
  $("pf-keluar").addEventListener("click", e => {
    e.preventDefault();
    if (confirm("Keluar dari akun " + akun.nama + "?")) Auth.logout();
  });
  if (role === "pembudidaya" && typeof refreshNotif === "function") refreshNotif();
}

// ---------- Profil ----------
function renderProfil(p) {
  $("pf-role").textContent = NAMA_ROLE[p.role] || p.role;
  $("pf-role").className = "role-tag " + p.role;
  $("pf-judul").textContent = p.nama;
  $("pf-sub").textContent = p.role === "validator"
    ? "Kelola profil penyuluh dan lihat riwayat validasi yang sudah kamu lakukan."
    : "Kelola informasi akun dan kata sandi.";
  $("pf-meta").innerHTML = `<span>Role: <strong>${NAMA_ROLE[p.role]}</strong></span>
    <span>Terdaftar sejak: <strong>${tgl(p.created_at)}</strong></span>`;
  $("pf-nama").value = p.nama;
  $("pf-email").value = p.email;
  $("pf-lokasi").value = p.lokasi || "";
  $("pf-info").textContent = {
    pembudidaya: "Nama dan lokasi kolam tampil ke penyuluh saat kamu mengajukan validasi.",
    validator: "Nama dan wilayah kerja tampil ke pembudidaya di hasil validasi.",
    admin: "Informasi akun pengelola sistem."
  }[p.role] || "";
  $("pf-lokasi-label").textContent = p.role === "validator" ? "Wilayah kerja" : p.role === "admin" ? "Lokasi" : "Lokasi kolam";

  const s = p.statistik || {};
  const stats = p.role === "validator"
    ? [["Total validasi", s.validasi], ["Sesuai model", s.sesuai], ["Dikoreksi", s.dikoreksi], ["Bulan ini", s.bulan_ini]]
    : [["Total scan", s.scan], ["Konsultasi", s.konsultasi], ["Sudah divalidasi", s.divalidasi]];
  $("pf-stats").innerHTML = stats.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd ?? 0}</dd></div>`).join("");
}

async function muatProfil() {
  try {
    const p = await api("/api/me");
    renderProfil(p);
  } catch (err) {
    toast(err.message);
  }
}

$("form-profil").addEventListener("submit", async e => {
  e.preventDefault();
  const body = { nama: $("pf-nama").value.trim(), email: $("pf-email").value.trim(), lokasi: $("pf-lokasi").value.trim() };
  if (!body.nama || !body.email) {
    $("profil-msg").innerHTML = `<div class="alert alert-error">Nama dan email wajib diisi.</div>`;
    return;
  }
  try {
    const u = await api("/api/me", { method: "PUT", body });
    Auth.save(Auth.token(), u);   // perbarui nama di navbar & halaman lain
    akun = u;
    $("profil-msg").innerHTML = "";
    toast("Profil disimpan.");
    muatProfil();
  } catch (err) {
    $("profil-msg").innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
});

$("form-sandi").addEventListener("submit", async e => {
  e.preventDefault();
  const lama = $("pw-lama").value, baru = $("pw-baru").value, ulang = $("pw-ulang").value;
  const msg = $("sandi-msg");
  if (!lama || !baru) return (msg.innerHTML = `<div class="alert alert-error">Isi kata sandi lama dan baru.</div>`);
  if (baru.length < 8) return (msg.innerHTML = `<div class="alert alert-error">Kata sandi baru minimal 8 karakter.</div>`);
  if (baru !== ulang) return (msg.innerHTML = `<div class="alert alert-error">Ulangi kata sandi baru belum sama.</div>`);
  try {
    await api("/api/me/password", { method: "PUT", body: { lama, baru } });
    $("form-sandi").reset();
    msg.innerHTML = "";
    toast("Kata sandi diperbarui.");
  } catch (err) {
    msg.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
});

// ---------- Riwayat validasi (validator) ----------
function renderRiwayat() {
  const q = $("rv-q").value.trim().toLowerCase();
  const f = $("rv-f").value;
  const list = riwayat
    .filter(r => !q || r.pengguna.nama.toLowerCase().includes(q))
    .filter(r => !f || (f === "sesuai") === (r.konsultasi.diagnosis === r.label));

  $("tb-riwayat").innerHTML = list.length ? list.map(r => {
    const k = r.konsultasi;
    const koreksi = k.diagnosis !== r.label;
    return `
      <tr>
        <td><img src="${r.image}" alt=""></td>
        <td><strong>${escapeHTML(r.pengguna.nama)}</strong>${r.pengguna.lokasi ? `<div class="muted">${escapeHTML(r.pengguna.lokasi)}</div>` : ""}</td>
        <td>${escapeHTML(namaDiagnosis(r.label))} <span class="muted">${Math.round(r.confidence * 100)}%</span></td>
        <td><span class="pill ${k.diagnosis === "sehat" ? "pill-healthy" : "pill-sick"}">${escapeHTML(namaDiagnosis(k.diagnosis))}</span>
          ${koreksi ? `<div class="muted">dikoreksi</div>` : ""}</td>
        <td>${KEPARAHAN[k.keparahan] || "-"}</td>
        <td class="muted">${tgl(k.divalidasi)}</td>
        <td><a class="link-btn" href="hasil.html?id=${r.id}">Lihat</a></td>
      </tr>`;
  }).join("") : `<tr><td colspan="7" class="pf-empty">${riwayat.length ? "Tidak ada yang cocok." : "Belum ada validasi."}</td></tr>`;
}

async function muatRiwayat() {
  $("pf-riwayat").classList.remove("hidden");
  try {
    riwayat = await api("/api/validator/riwayat");
    renderRiwayat();
  } catch (err) {
    toast(err.message);
  }
}
$("rv-q").addEventListener("input", renderRiwayat);
$("rv-f").addEventListener("change", renderRiwayat);

// ---------- Mulai ----------
buatNavbar();
muatProfil();
if (akun.role === "validator") muatRiwayat();
