// =========================================================
// Halaman Login/Daftar (terhubung ke backend)
// =========================================================

const tabs = document.querySelectorAll(".tabs button");
const forms = { login: document.getElementById("form-login"), register: document.getElementById("form-register") };
const msg = document.getElementById("auth-msg");
const params = new URLSearchParams(location.search);

function showMsg(text, type = "error") {
  msg.innerHTML = text ? `<div class="alert alert-${type}">${text}</div>` : "";
}

function setLoading(form, loading, label) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.disabled = loading;
  btn.textContent = loading ? label : btn.dataset.label;
}

// Ke mana setelah login: halaman asal (?next=) atau sesuai role
function tujuan(user) {
  const next = params.get("next") || "";
  const aman = /^[a-z]+\.html(\?[\w=&%-]*)?$/i.test(next) && next !== "login.html";
  if (user.role === "admin") return "admin.html";
  if (user.role === "validator") return next.startsWith("validator.html") ? next : "validator.html";
  return aman && !/^(validator|admin)\.html/.test(next) ? next : "index.html";
}

async function masuk(email, password) {
  const d = await api("/api/login", { method: "POST", body: { email, password } });
  Auth.save(d.token, d.user);
  location.href = tujuan(d.user);
}

tabs.forEach(btn => btn.addEventListener("click", () => {
  tabs.forEach(b => b.classList.toggle("active", b === btn));
  Object.entries(forms).forEach(([k, f]) => f.classList.toggle("hidden", k !== btn.dataset.tab));
  showMsg("");
}));

// Sudah login? langsung arahkan
if (Auth.isLoggedIn()) {
  location.replace(tujuan(Auth.user()));
} else if (params.get("expired")) {
  showMsg("Sesi kamu sudah habis. Silakan masuk lagi.", "info");
} else if (params.get("next")) {
  showMsg("Masuk dulu untuk melanjutkan.", "info");
}

forms.login.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-pass").value;
  if (!email || !pass) return showMsg("Isi email dan kata sandi untuk masuk.");
  if (!forms.login.checkValidity()) return showMsg("Format email belum benar.");

  setLoading(forms.login, true, "Memeriksa…");
  try {
    await masuk(email, pass);
  } catch (err) {
    showMsg(err.message);
    setLoading(forms.login, false);
  }
});

forms.register.addEventListener("submit", async e => {
  e.preventDefault();
  const nama = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass = document.getElementById("reg-pass").value;
  const lokasiEl = document.getElementById("reg-lokasi");
  const lokasi = lokasiEl ? lokasiEl.value.trim() : "";
  if (!nama || !email || !pass) return showMsg("Lengkapi nama, email, dan kata sandi.");
  if (!forms.register.checkValidity()) return showMsg("Periksa lagi: email harus valid dan kata sandi minimal 8 karakter.");

  setLoading(forms.register, true, "Membuat akun…");
  try {
    await api("/api/register", { method: "POST", body: { nama, email, password: pass, lokasi } });
    await masuk(email, pass); // langsung masuk setelah daftar
  } catch (err) {
    showMsg(err.message);
    setLoading(forms.register, false);
  }
});
