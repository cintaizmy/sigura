// =========================================================
// Koneksi ke backend Flask + data login
// Dipasang di SEMUA halaman, sebelum main.js
// =========================================================

// Alamat backend. Ganti kalau backend jalan di alamat lain.
const API_BASE = "http://127.0.0.1:5000";

const TOKEN_KEY = "sigurame:token";
const USER_KEY = "sigurame:user";

const Auth = {
  token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  isLoggedIn() {
    return !!(this.token() && this.user());
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  logout() {
    this.clear();
    location.href = "index.html";
  }
};

// Halaman saat ini, misalnya "hasil.html?id=3"
function halamanIni() {
  return (location.pathname.split("/").pop() || "index.html") + location.search;
}

// Taruh di baris paling atas script halaman yang wajib login.
// role: "validator" untuk halaman khusus validator.
function wajibLogin(role) {
  const user = Auth.user();
  if (!Auth.isLoggedIn()) {
    location.replace("login.html?next=" + encodeURIComponent(halamanIni()));
    throw new Error("Belum login, diarahkan ke halaman masuk.");
  }
  if (role && user.role !== role) {
    location.replace({ validator: "validator.html", admin: "admin.html" }[user.role] || "index.html");
    throw new Error("Role tidak sesuai.");
  }
  return user;
}

// Panggil API. Contoh:
//   const data = await api("/api/scans");
//   await api("/api/login", { method: "POST", body: { email, password } });
//   await api("/predict", { method: "POST", form: formData });
async function api(path, { method = "GET", body, form, timeout = 20000, keepalive = false } = {}) {
  const headers = {};
  const token = Auth.token();
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
      keepalive
    });
  } catch {
    throw new Error("Tidak bisa terhubung ke server. Pastikan backend sudah dijalankan (python app.py).");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));

  // Token kedaluwarsa atau rusak: minta login ulang
  if ((res.status === 401 || res.status === 422) && token) {
    Auth.clear();
    location.href = "login.html?expired=1&next=" + encodeURIComponent(halamanIni());
    throw new Error("Sesi habis, silakan masuk lagi.");
  }
  if (!res.ok) throw new Error(data.error || data.msg || `Terjadi kesalahan (${res.status}).`);
  return data;
}
