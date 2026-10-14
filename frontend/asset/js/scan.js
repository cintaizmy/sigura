// =========================================================
// Halaman Scan (interaktif)
// Mode unggah / kamera -> cek kualitas foto -> kirim ke backend (api.js)
// =========================================================

// Wajib login supaya hasil scan tersimpan di riwayat akun
wajibLogin();

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const $ = id => document.getElementById(id);
const stage = $("stage");
const video = $("video");
const preview = $("preview");
const message = $("message");
const steps = document.querySelectorAll("#scan-steps li");
const modeButtons = document.querySelectorAll(".mode-switch button");

let selectedFile = null;
let stream = null;
let mode = "upload";

// ---------- Utilitas ----------
function showMessage(text, type = "error") {
  message.innerHTML = text ? `<div class="alert alert-${type}">${text}</div>` : "";
}

function setStep(n) {
  steps.forEach((li, i) => {
    li.classList.toggle("done", i < n - 1);
    li.classList.toggle("active", i === n - 1);
  });
}

// state: upload | camera | preview | scanning
function setState(state) {
  stage.dataset.state = state;
  document.querySelector(".scan-card").dataset.state = state;
}

// ---------- Mode unggah / kamera ----------
function setMode(m) {
  mode = m;
  modeButtons.forEach(b => {
    const on = b.dataset.mode === m;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  document.querySelector(".mode-switch").dataset.mode = m;
  showMessage("");
  if (selectedFile) return; // sedang pratinjau, jangan ganggu
  if (m === "camera") startCamera();
  else { stopCamera(); setState("upload"); }
}

async function startCamera() {
  setState("camera");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return kameraGagal();
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    console.warn(err);
    kameraGagal();
  }
}

function kameraGagal() {
  // Fallback: kamera bawaan HP lewat input file
  showMessage(
    `Kamera tidak bisa dibuka di browser ini. Izinkan akses kamera, atau buka lewat Live Server (http://127.0.0.1), bukan file://.
     <br><label for="input-camera" class="link-btn">Buka kamera HP</label>`
  );
  setMode("upload");
}

function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

function capture() {
  if (!stream) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  stage.classList.add("flash");
  setTimeout(() => stage.classList.remove("flash"), 300);
  canvas.toBlob(blob => {
    const file = new File([blob], `kamera-${Date.now()}.jpg`, { type: "image/jpeg" });
    stopCamera();
    handleFile(file);
  }, "image/jpeg", 0.92);
}

// ---------- Pilih file ----------
function handleFile(file) {
  showMessage("");
  if (!file) return;
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    stage.classList.add("shake");
    setTimeout(() => stage.classList.remove("shake"), 400);
    return showMessage("Format file tidak didukung. Gunakan foto JPG atau PNG.");
  }
  if (file.size > MAX_SIZE) {
    return showMessage("Ukuran foto lebih dari 5 MB. Kecilkan ukuran foto lalu coba lagi.");
  }
  selectedFile = file;
  if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  preview.onload = () => cekKualitas(preview);
  setState("preview");
  setStep(2);
}

function resetScan() {
  selectedFile = null;
  preview.removeAttribute("src");
  $("quality").innerHTML = "";
  document.querySelectorAll('input[type="file"]').forEach(i => (i.value = ""));
  showMessage("");
  setStep(1);
  setMode(mode);
}

// ---------- Cek kualitas foto (di browser, perkiraan) ----------
function cekKualitas(img) {
  const size = 160;
  const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  // Kecerahan rata-rata & grayscale
  const gray = new Float32Array(w * h);
  let total = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    total += gray[p];
  }
  const terang = total / gray.length;

  // Ketajaman: variansi Laplacian
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const tajam = sumSq / n - (sum / n) ** 2;
  const resolusi = Math.min(img.naturalWidth, img.naturalHeight);

  const cek = [
    {
      ok: terang > 55 && terang < 245,
      baik: "Pencahayaan cukup",
      buruk: terang <= 55 ? "Foto terlalu gelap" : "Foto terlalu terang"
    },
    { ok: tajam > 60, baik: "Foto cukup tajam", buruk: "Foto terlihat blur" },
    { ok: resolusi >= 300, baik: "Resolusi cukup", buruk: "Resolusi terlalu kecil" }
  ];

  const list = $("quality");
  list.innerHTML = "";
  cek.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "checking";
    li.textContent = "Mengecek…";
    list.appendChild(li);
    // muncul satu per satu
    setTimeout(() => {
      li.className = c.ok ? "ok" : "warn";
      li.textContent = c.ok ? c.baik : c.buruk;
    }, 250 + i * 250);
  });

  const masalah = cek.filter(c => !c.ok).length;
  setTimeout(() => {
    if (masalah) {
      showMessage("Kualitas foto kurang ideal, hasil deteksi bisa kurang akurat. Kamu tetap bisa lanjut scan atau ganti foto.", "info");
    }
  }, 250 + cek.length * 250);
}

// ---------- Kirim ke backend ----------
// Backend: POST /predict  ->  { label, confidence, demo, scan_id }
function predict(file) {
  const form = new FormData();
  form.append("file", file);
  return api("/predict", { method: "POST", form, timeout: 30000 });
}

async function mulaiScan() {
  if (!selectedFile) return;
  setState("scanning");
  showMessage("");
  $("btn-scan").disabled = true;
  $("btn-reset").disabled = true;

  // Progress & teks bergantian
  const tahap = ["Menganalisis foto…", "Memeriksa sisik dan sirip…", "Mencocokkan gejala…", "Menyusun hasil…"];
  const bar = $("progress-bar");
  const text = $("loading-text");
  let t = 0;
  bar.style.width = "8%";
  text.textContent = tahap[0];
  const timer = setInterval(() => {
    t++;
    text.textContent = tahap[Math.min(t, tahap.length - 1)];
    bar.style.width = Math.min(90, 8 + t * 22) + "%";
  }, 450);

  let result;
  try {
    [result] = await Promise.all([
      predict(selectedFile),
      new Promise(r => setTimeout(r, 1800)) // jeda minimum agar animasi terlihat
    ]);
    if (!result.scan_id) throw new Error("Hasil tidak tersimpan. Coba keluar lalu masuk lagi.");
  } catch (err) {
    clearInterval(timer);
    bar.style.width = "0";
    setState("preview");
    $("btn-scan").disabled = false;
    $("btn-reset").disabled = false;
    return showMessage(err.message);
  }

  clearInterval(timer);
  bar.style.width = "100%";
  text.textContent = "Selesai";
  setStep(3);
  setTimeout(() => (window.location.href = "hasil.html?id=" + result.scan_id), 350);
}

// ---------- Event ----------
modeButtons.forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

$("input-gallery").addEventListener("change", e => handleFile(e.target.files[0]));
$("input-camera").addEventListener("change", e => handleFile(e.target.files[0]));
$("btn-shutter").addEventListener("click", capture);
$("btn-reset").addEventListener("click", resetScan);
$("btn-scan").addEventListener("click", mulaiScan);

// Drag & drop
["dragenter", "dragover"].forEach(ev =>
  stage.addEventListener(ev, e => {
    e.preventDefault();
    if (stage.dataset.state === "upload") stage.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove("dragover"); })
);
stage.addEventListener("drop", e => {
  if (stage.dataset.state === "upload") handleFile(e.dataTransfer.files[0]);
});

// Tempel dari clipboard (Ctrl/Cmd + V)
window.addEventListener("paste", e => {
  if (stage.dataset.state !== "upload") return;
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) handleFile(item.getAsFile());
});

// Spasi = ambil foto saat mode kamera
window.addEventListener("keydown", e => {
  if (e.code === "Space" && stage.dataset.state === "camera" && document.activeElement.tagName !== "BUTTON") {
    e.preventDefault();
    capture();
  }
});

window.addEventListener("pagehide", stopCamera);

setState("upload");
