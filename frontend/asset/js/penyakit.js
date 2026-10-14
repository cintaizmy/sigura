// =========================================================
// Halaman Penyakit: pencarian, filter, pencocok gejala, detail
// Foto contoh: asset/image/<foto atau key>.jpg (misalnya bercak_merah.jpg)
// =========================================================

const $ = id => document.getElementById(id);
const daftar = Object.entries(PENYAKIT).filter(([key]) => key !== "sehat");
const kategoriList = ["Semua", ...new Set(daftar.map(([, p]) => p.kategori))];
const semuaGejala = [...new Set(daftar.flatMap(([, p]) => p.gejala))];

let kategoriAktif = "Semua";
let gejalaDipilih = new Set();
let tabAktif = "gejala";
let keyAktif = null;

// ---------- Filter kategori ----------
$("cat-filter").innerHTML = kategoriList.map(k => `
  <button type="button" role="radio" aria-checked="${k === "Semua"}" data-cat="${k}" class="${k === "Semua" ? "active" : ""}">
    ${k}${k !== "Semua" ? ` <span>${daftar.filter(([, p]) => p.kategori === k).length}</span>` : ""}
  </button>`).join("");

$("cat-filter").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  kategoriAktif = btn.dataset.cat;
  $("cat-filter").querySelectorAll("button").forEach(b => {
    b.classList.toggle("active", b === btn);
    b.setAttribute("aria-checked", b === btn);
  });
  render();
});

// ---------- Pencocok gejala ----------
// Gejala dikelompokkan per bagian tubuh supaya mudah dipindai
const GRUP_GEJALA = {
  "Kulit dan luka": ["bercak", "luka", "lapisan putih", "bintik", "titik merah", "parasit"],
  "Sirip dan sisik": ["sirip", "sisik"],
  "Bentuk tubuh": ["perut", "mata"],
  "Perilaku": ["lemas", "berenang", "menggesek", "napas", "diam"]
};

function grupDari(gejala) {
  const g = gejala.toLowerCase();
  // cek "Kulit dan luka" terakhir supaya "sisik lepas di sekitar luka" masuk ke sisik
  const urutan = ["Sirip dan sisik", "Bentuk tubuh", "Perilaku", "Kulit dan luka"];
  // Sirip/sisik & bentuk tubuh: harus di awal kalimat; lainnya boleh di tengah
  const awalSaja = ["Sirip dan sisik", "Bentuk tubuh"];
  const ketemu = urutan.find(nama => GRUP_GEJALA[nama].some(kata =>
    g.startsWith(kata) || (!awalSaja.includes(nama) && g.includes(" " + kata))
  ));
  return ketemu || "Lainnya";
}

const grup = {};
semuaGejala.forEach((g, i) => {
  const nama = grupDari(g);
  (grup[nama] = grup[nama] || []).push({ g, i });
});

$("symptom-chips").innerHTML = Object.keys(GRUP_GEJALA).concat("Lainnya")
  .filter(nama => grup[nama])
  .map(nama => `
    <fieldset class="symptom-group">
      <legend>${nama}</legend>
      ${grup[nama].map(({ g, i }) =>
        `<button type="button" aria-pressed="false" data-i="${i}">${escapeHTML(g)}</button>`
      ).join("")}
    </fieldset>`).join("");

function updateMatcherInfo() {
  const n = gejalaDipilih.size;
  $("matcher-badge").textContent = n;
  $("matcher-badge").classList.toggle("hidden", n === 0);
  $("matcher-sub").textContent = n
    ? `${n} gejala dipilih`
    : "Pilih gejala yang kamu lihat, penyakit paling cocok akan naik ke atas.";
}

function toggleMatcher(buka) {
  const t = $("matcher-toggle");
  const open = buka ?? t.getAttribute("aria-expanded") !== "true";
  t.setAttribute("aria-expanded", open);
  $("matcher-panel").hidden = !open;
  $("matcher").classList.toggle("open", open);
}

$("matcher-toggle").addEventListener("click", () => toggleMatcher());

$("symptom-chips").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const g = semuaGejala[btn.dataset.i];
  gejalaDipilih.has(g) ? gejalaDipilih.delete(g) : gejalaDipilih.add(g);
  btn.setAttribute("aria-pressed", gejalaDipilih.has(g));
  updateMatcherInfo();
  render();
});

$("btn-clear-gejala").addEventListener("click", () => {
  gejalaDipilih.clear();
  $("symptom-chips").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false"));
  updateMatcherInfo();
  render();
});

$("btn-apply").addEventListener("click", () => {
  toggleMatcher(false);
  $("ency-count").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Kartu ----------
function fotoHTML(key, nama) {
  const file = (PENYAKIT[key] && PENYAKIT[key].foto) || key;
  return `
    <img src="asset/image/${file}.jpg" alt="Contoh ${escapeHTML(nama)}" loading="lazy"
         onerror="this.remove()">
    <div class="photo-fallback" aria-hidden="true"><img src="asset/image/icon.png" alt=""></div>`;
}

function render() {
  const q = $("search").value.trim().toLowerCase();

  let hasil = daftar
    .map(([key, p]) => {
      const cocok = p.gejala.filter(g => gejalaDipilih.has(g)).length;
      return { key, p, cocok };
    })
    .filter(({ p }) => kategoriAktif === "Semua" || p.kategori === kategoriAktif)
    .filter(({ p }) => {
      if (!q) return true;
      const teks = [p.nama, p.latin, p.ringkasan, ...p.gejala, ...p.penyebab,
        ...(p.jenis || []).map(j => j.nama + " " + j.latin)].join(" ").toLowerCase();
      return teks.includes(q);
    });

  if (gejalaDipilih.size) {
    hasil = hasil.filter(h => h.cocok > 0).sort((a, b) => b.cocok - a.cocok);
  }

  $("btn-clear-gejala").classList.toggle("hidden", gejalaDipilih.size === 0);
  $("no-match").classList.toggle("hidden", hasil.length > 0);
  $("ency-count").textContent = gejalaDipilih.size
    ? `${hasil.length} penyakit cocok dengan ${gejalaDipilih.size} gejala yang dipilih`
    : `${hasil.length} penyakit`;

  $("disease-grid").innerHTML = hasil.map(({ key, p, cocok }, i) => `
    <article class="d-card ${gejalaDipilih.size && i === 0 ? "top-match" : ""}" style="--i:${i}">
      <button type="button" class="d-card-btn" data-key="${key}" aria-label="Lihat detail ${escapeHTML(p.nama)}">
        <div class="d-photo">${fotoHTML(key, p.nama)}</div>
        <div class="d-info">
          <div class="d-tags">
            <span class="pill pill-cat">${p.kategori}</span>
            ${p.bisaScan ? `<span class="pill pill-healthy">Bisa dideteksi scan</span>` : `<span class="match">Belum bisa dideteksi scan</span>`}
            ${gejalaDipilih.size ? `<span class="match">${cocok} dari ${p.gejala.length} gejala cocok</span>` : ""}
          </div>
          <h2>${escapeHTML(p.nama)}</h2>
          <p class="d-latin">${escapeHTML(p.latin)}</p>
          <p class="d-sum">${escapeHTML(p.ringkasan)}</p>
          <span class="d-more">Lihat detail</span>
        </div>
      </button>
    </article>`).join("");
}

$("disease-grid").addEventListener("click", e => {
  const btn = e.target.closest(".d-card-btn");
  if (btn) bukaDetail(btn.dataset.key);
});

$("search").addEventListener("input", render);
$("btn-reset-filter").addEventListener("click", () => {
  $("search").value = "";
  $("cat-filter").querySelector('[data-cat="Semua"]').click();
  if (gejalaDipilih.size) $("btn-clear-gejala").click();
});

// ---------- Detail (drawer) ----------
const drawer = $("drawer");

function renderList() {
  const p = PENYAKIT[keyAktif];
  if (tabAktif === "jenis") {
    $("d-list").innerHTML = (p.jenis || []).map(j =>
      `<li><strong>${escapeHTML(j.nama)}</strong> <em style="color:var(--slate)">(${escapeHTML(j.latin)})</em><br>${escapeHTML(j.ciri)}</li>`
    ).join("");
    $("d-list").dataset.tab = "jenis";
    return;
  }
  $("d-list").innerHTML = p[tabAktif].map(t => {
    const cocok = tabAktif === "gejala" && gejalaDipilih.has(t);
    return `<li class="${cocok ? "is-match" : ""}">${escapeHTML(t)}</li>`;
  }).join("");
  $("d-list").dataset.tab = tabAktif;
}

function bukaDetail(key) {
  const p = PENYAKIT[key];
  if (!p || key === "sehat") return;
  keyAktif = key;
  tabAktif = p.jenis ? "jenis" : "gejala";
  $("d-tab-jenis").classList.toggle("hidden", !p.jenis);

  $("d-photo").innerHTML = fotoHTML(key, p.nama);
  $("d-kategori").textContent = p.kategori;
  $("d-nama").textContent = p.nama;
  $("d-latin").textContent = p.latin;
  $("d-ringkasan").textContent = p.ringkasan + (p.bisaScan ? "" :
    " Catatan: penyakit ini belum bisa dideteksi lewat scan SiGurame. Gunakan konsultasi lanjutan agar penyuluh memeriksa.");
  $("d-tabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.tab === tabAktif));
  renderList();

  if (!drawer.open) drawer.showModal();
  history.replaceState(null, "", "#" + key);
}

function tutupDetail() {
  drawer.classList.add("closing");
  setTimeout(() => {
    drawer.classList.remove("closing");
    drawer.close();
  }, 220);
}

drawer.addEventListener("close", () => history.replaceState(null, "", location.pathname));
$("drawer-close").addEventListener("click", tutupDetail);
drawer.addEventListener("click", e => { if (e.target === drawer) tutupDetail(); }); // klik di luar panel
drawer.addEventListener("cancel", e => { e.preventDefault(); tutupDetail(); });     // tombol Esc

$("d-tabs").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  tabAktif = btn.dataset.tab;
  $("d-tabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
  renderList();
});

// ---------- Mulai ----------
render();
const hash = location.hash.slice(1);
if (PENYAKIT[hash]) bukaDetail(hash);
window.addEventListener("hashchange", () => {
  const k = location.hash.slice(1);
  if (PENYAKIT[k]) bukaDetail(k);
});
