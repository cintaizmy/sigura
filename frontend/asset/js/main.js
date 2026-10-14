// =========================================================
// Script umum untuk semua halaman
// =========================================================

// ---------- Toggle menu navbar di layar kecil ----------
const toggle = document.querySelector(".nav-toggle");
const links = document.querySelector(".nav-links");

if (toggle && links) {
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open);
  });
}

// ---------- Slider demo di beranda ----------
const track = document.getElementById("slider-track");

if (track) {
  const slides = track.querySelectorAll("img");
  const chip = document.getElementById("demo-chip");
  const dot = document.getElementById("demo-dot");
  const label = document.getElementById("demo-label");
  const conf = document.getElementById("demo-conf");
  const bar = document.getElementById("demo-bar");       // opsional
  const dotsWrap = document.getElementById("slider-dots"); // opsional
  let current = 0;
  let timer = null;

  // Buat tombol indikator sesuai jumlah foto
  const dots = [];
  if (dotsWrap) {
    slides.forEach((img, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", `Contoh ${i + 1}: ${img.dataset.label}`);
      b.addEventListener("click", () => { show(i); restart(); });
      dotsWrap.appendChild(b);
      dots.push(b);
    });
  }

  function show(n) {
    current = (n + slides.length) % slides.length;
    track.style.transform = `translateX(-${current * 100}%)`;

    const s = slides[current].dataset;
    const sakit = s.status === "sakit";
    chip.classList.toggle("sick", sakit);
    dot.textContent = sakit ? "!" : "✓";
    label.textContent = s.label;
    conf.textContent = `Keyakinan model ${s.conf}%`;
    if (bar) bar.style.width = s.conf + "%";
    dots.forEach((d, i) => d.setAttribute("aria-current", i === current));
  }

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function restart() {
    if (reduce) return;
    clearInterval(timer);
    timer = setInterval(() => show(current + 1), 4000);
  }

  show(0);
  restart();
}

// ---------- Tombol Masuk / Keluar di navbar ----------
(function navbarLogin() {
  if (typeof Auth === "undefined") return;
  const user = Auth.user();

  // Navbar validator: tombol "Keluar" = logout
  const keluarValidator = document.querySelector(".navbar-validator .nav-links a.btn");
  if (keluarValidator) {
    keluarValidator.addEventListener("click", e => { e.preventDefault(); Auth.logout(); });
    return;
  }

  const masuk = document.querySelector('.nav-links a[href="login.html"]');
  if (!masuk || !Auth.isLoggedIn()) return;

  // Sapaan + tautan ke halaman validator (kalau role validator)
  const li = document.createElement("li");
  li.innerHTML = user.role === "validator" ? `<a href="validator.html">Halaman validator</a>`
    : user.role === "admin" ? `<a href="admin.html">Panel admin</a>`
    : `<span style="opacity:.75">Hai, ${escapeNama(user.nama)}</span>`;
  masuk.parentElement.before(li);

  masuk.textContent = "Keluar";
  masuk.href = "#";
  masuk.title = "Masuk sebagai " + user.nama;
  masuk.addEventListener("click", e => {
    e.preventDefault();
    if (confirm("Keluar dari akun " + user.nama + "?")) Auth.logout();
  });

  function escapeNama(s) {
    // "Budi, Penyuluh Perikanan" -> "Budi"; "Pak Slamet" tetap utuh
    return String(s).split(",")[0].trim().slice(0, 24).replace(/[&<>"']/g, "");
  }
})();

// ---------- Notifikasi balasan validator (sisi pengguna) ----------
// Badge angka di menu Riwayat + toast di pojok layar.
// Dicek ke backend saat halaman dibuka dan tiap 30 detik.

async function countBalasanBaru() {
  if (typeof api === "undefined" || !Auth.isLoggedIn() || Auth.user().role !== "pembudidaya") return 0;
  try {
    const d = await api("/api/notifikasi");
    return d.balasan_baru || 0;
  } catch {
    return 0;
  }
}

async function refreshNotif() {
  if (document.body.dataset.role === "validator") return;
  const n = await countBalasanBaru();

  // Badge di menu Riwayat
  const link = document.querySelector('.nav-links a[href="riwayat.html"]');
  if (link) {
    let badge = link.querySelector(".nav-badge");
    if (n > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-badge";
        link.appendChild(badge);
      }
      badge.textContent = n;
      badge.title = `${n} balasan validator baru`;
    } else if (badge) {
      badge.remove();
    }
  }

  // Toast (tidak ditampilkan di halaman Riwayat & Hasil karena info sudah terlihat di sana)
  const page = location.pathname.split("/").pop() || "index.html";
  const skip = ["riwayat.html", "hasil.html"].includes(page);
  const ditutup = Number(sessionStorage.getItem("sigurame:toast-tutup") || 0);
  let toast = document.getElementById("notif-toast");

  if (n > 0 && !skip && n !== ditutup) {
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "notif-toast";
      toast.className = "toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.innerHTML = `
      <div>
        <strong>Validator sudah membalas</strong>
        <p>${n} konsultasi kamu punya jawaban baru.</p>
      </div>
      <a href="riwayat.html" class="btn btn-primary">Lihat</a>
      <button class="toast-close" aria-label="Tutup notifikasi">×</button>`;
    toast.querySelector(".toast-close").addEventListener("click", () => {
      sessionStorage.setItem("sigurame:toast-tutup", n);
      toast.remove();
    });
  } else if (toast) {
    toast.remove();
  }
}

refreshNotif();
setInterval(refreshNotif, 30000);
