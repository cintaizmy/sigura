"""
SiGura - Backend Flask API
Jalankan:  python app.py   lalu buka  http://127.0.0.1:5000

Akun bawaan (dibuat otomatis saat pertama jalan):
  Validator : validator@sigurame.id / validator123
  Admin     : admin@sigurame.id     / admin123
"""

import html as htmllib
import re
import json
import os
import random
import smtplib
import sqlite3
import threading
import uuid
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from functools import wraps
from io import BytesIO

import numpy as np
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, get_jwt, get_jwt_identity,
    jwt_required, verify_jwt_in_request,
)
from PIL import Image, ImageDraw, UnidentifiedImageError
from werkzeug.security import check_password_hash, generate_password_hash

# =========================================================
# Konfigurasi
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "sigurame.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
MODEL_PATH = os.path.join(BASE_DIR, "model", "model.h5")   # model Keras hasil training tim
TORCH_PATH = os.path.join(BASE_DIR, "model", "model.pth")  # model PyTorch (uji coba)

IMG_SIZE = (224, 224)          # HARUS sama dengan ukuran input saat training
MAX_SIZE = 5 * 1024 * 1024     # 5 MB
ALLOWED_MIME = {"image/jpeg", "image/png"}

# Kelas yang bisa dideteksi model (sesuai dokumen SRS).
# Urutan HARUS sama dengan urutan kelas saat training (urut abjad nama folder dataset).
# Nama = key di frontend/asset/js/data.js
CLASSES = ["bakteri", "jamur", "sehat"]

# Data penyakit (ensiklopedia) disimpan di tabel `penyakit` dan dikelola admin.
# Isi awal diambil dari file penyakit_awal.json saat database pertama dibuat.
PENYAKIT_AWAL_PATH = os.path.join(BASE_DIR, "penyakit_awal.json")
FIELD_LIST = ("gejala", "penyebab", "pencegahan", "penanganan")

# Layanan validasi berbayar (BR-03). Pembayaran masih simulasi, belum payment gateway.
TARIF_VALIDASI = 25000
METODE_BAYAR = {"qris": "QRIS", "transfer": "Transfer bank", "ewallet": "E-wallet"}
ESTIMASI_VALIDASI = "Maksimal 1×24 jam pada hari kerja"
KETENTUAN_VALIDASI = [
    "Validasi dilakukan oleh penyuluh perikanan berdasarkan foto dan catatan yang kamu kirim.",
    "Hasil validasi berupa diagnosis, tingkat keparahan, dan rekomendasi penanganan khusus.",
    "Biaya yang sudah dibayar tidak dapat dikembalikan setelah validasi selesai.",
    "Untuk kasus berat, penyuluh dapat menyarankan pemeriksaan langsung di kolam.",
]

# Pengaturan email ada di file pengaturan_email.json (lihat bagian Email)
EMAIL_CFG_PATH = os.path.join(BASE_DIR, "pengaturan_email.json")

ROLES = ("pembudidaya", "validator", "admin")
DUMMY_DOMAIN = "@contoh.sigurame"   # akun pembudidaya untuk data contoh

os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_SIZE + 1024 * 1024
app.json.sort_keys = False   # pertahankan urutan data (misalnya urutan penyakit)
app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET", "sigurame-dev-secret-ganti-saat-deploy-2026")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)
CORS(app)
jwt = JWTManager(app)


# =========================================================
# Database (SQLite, file sigurame.db dibuat otomatis)
# =========================================================
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'pembudidaya',   -- pembudidaya | validator | admin
  lokasi TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence REAL NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS konsultasi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER UNIQUE NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  catatan_user TEXT,
  status TEXT NOT NULL DEFAULT 'menunggu_bayar', -- menunggu_bayar | menunggu | selesai
  diagnosis TEXT,
  keparahan TEXT,                             -- ringan | sedang | berat
  pesan TEXT,
  validator_id INTEGER REFERENCES users(id),
  validator_nama TEXT,
  dikirim TEXT NOT NULL,
  divalidasi TEXT,
  dibaca INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS penyakit (
  key TEXT PRIMARY KEY,                       -- sama dengan label model (sehat, bakteri, jamur, ...)
  urutan INTEGER NOT NULL DEFAULT 0,
  bisa_scan INTEGER NOT NULL DEFAULT 0,       -- 1 = termasuk kelas model
  data TEXT NOT NULL,                         -- JSON: nama, kategori, latin, ringkasan, gejala, ...
  diubah TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pembayaran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER UNIQUE NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  kode TEXT UNIQUE NOT NULL,                  -- ID transaksi
  jumlah INTEGER NOT NULL,
  metode TEXT,
  status TEXT NOT NULL DEFAULT 'menunggu',    -- menunggu | gagal | lunas
  dibuat TEXT NOT NULL,
  dibayar TEXT
);
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def now(offset_hours=0):
    return (datetime.now(timezone.utc) - timedelta(hours=offset_hours)).isoformat()


def kode_transaksi():
    return "TRX-" + datetime.now().strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:6].upper()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    # --- Penyesuaian database versi lama ---
    try:
        conn.execute("ALTER TABLE konsultasi ADD COLUMN validator_nama TEXT")
    except sqlite3.OperationalError:
        pass
    # Label lama (6 kelas) -> 3 kelas
    for lama, baru in [("bercak_merah", "bakteri"), ("perut_kembung", "bakteri")]:
        conn.execute("UPDATE scans SET label=? WHERE label=?", (baru, lama))
        conn.execute("UPDATE konsultasi SET diagnosis=? WHERE diagnosis=?", (baru, lama))
    # Konsultasi lama dianggap sudah dibayar
    for (sid,) in conn.execute("""SELECT k.scan_id FROM konsultasi k
                                  LEFT JOIN pembayaran p ON p.scan_id = k.scan_id
                                  WHERE p.id IS NULL AND k.status != 'menunggu_bayar'""").fetchall():
        conn.execute("INSERT INTO pembayaran (scan_id,kode,jumlah,metode,status,dibuat,dibayar) VALUES (?,?,?,?,?,?,?)",
                     (sid, kode_transaksi(), TARIF_VALIDASI, "qris", "lunas", now(), now()))
    # --- Data penyakit awal ---
    if not conn.execute("SELECT 1 FROM penyakit LIMIT 1").fetchone():
        try:
            with open(PENYAKIT_AWAL_PATH, encoding="utf-8") as f:
                awal = json.load(f)
        except (OSError, ValueError):
            awal = {}
        for i, (key, d) in enumerate(awal.items()):
            bisa = 1 if key in CLASSES else 0
            d = {k: v for k, v in d.items() if k != "bisaScan"}
            conn.execute("INSERT INTO penyakit (key,urutan,bisa_scan,data,diubah) VALUES (?,?,?,?,?)",
                         (key, i, bisa, json.dumps(d, ensure_ascii=False), now()))
    # --- Akun bawaan ---
    akun = [("Budi, Penyuluh Perikanan", "validator@sigurame.id", "validator123", "validator", "Sidoarjo"),
            ("Admin SiGura", "admin@sigurame.id", "admin123", "admin", None)]
    for nama, email, pw, role, lokasi in akun:
        if not conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            conn.execute("INSERT INTO users (nama,email,password_hash,role,lokasi,created_at) VALUES (?,?,?,?,?,?)",
                         (nama, email, generate_password_hash(pw), role, lokasi, now()))
    conn.commit()
    conn.close()


# =========================================================
# Model
# Backend otomatis memakai model yang ada di folder backend/model/:
#   - model.pth  -> model PyTorch (uji coba, VGG16 dari Hugging Face)
#   - model.h5   -> model Keras/TensorFlow (model hasil training tim di Colab)
# Kalau tidak ada keduanya, backend jalan di mode demo (hasil acak).
# =========================================================

# --- Model uji coba (PyTorch, 8 kelas) ---
# Sumber: huggingface.co/spaces/mathaisjustin/fish-disease-detection-ai
TORCH_CLASSES = ["Aeromoniasis", "Bacterial_gill_disease", "Bacterial_red_disease", "EUS",
                 "Healthy_Fish", "Parasitic_diseases", "Saprolegniasis_fungal", "Viral_white_tail"]
# Kelas model -> label web (3 kelas). Peluang kelas dengan label sama dijumlahkan.
# None = tidak termasuk 3 kelas SiGura, diabaikan.
PETA_TORCH = {
    "Healthy_Fish": "sehat",
    "Saprolegniasis_fungal": "jamur",   # jamur air Saprolegnia
    "EUS": "jamur",                     # Aphanomyces invadans (jamur air / oomycete)
    "Aeromoniasis": "bakteri",          # bakteri Aeromonas
    "Bacterial_red_disease": "bakteri",
    "Bacterial_gill_disease": "bakteri",
    "Parasitic_diseases": None,
    "Viral_white_tail": None,
}

model = None
model_jenis = "demo"

if os.path.exists(TORCH_PATH):
    try:
        import torch
        from torch import nn
        from torchvision import models as tv_models, transforms

        net = tv_models.vgg16(weights=None)
        net.classifier[6] = nn.Linear(4096, len(TORCH_CLASSES))
        net.load_state_dict(torch.load(TORCH_PATH, map_location="cpu", weights_only=True))
        net.eval()
        torch_tf = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        model, model_jenis = net, "pytorch"
        print(f"[OK] Model PyTorch dimuat: {TORCH_PATH}")
    except ImportError:
        print("[!] Ada model.pth tapi PyTorch belum terpasang: pip install torch torchvision")
    except Exception as e:
        print(f"[!] Gagal memuat model.pth: {e}")

if model is None and os.path.exists(MODEL_PATH):
    try:
        import tensorflow as tf  # noqa: E402
        model, model_jenis = tf.keras.models.load_model(MODEL_PATH), "keras"
        print(f"[OK] Model Keras dimuat: {MODEL_PATH}")
    except ImportError:
        print("[!] Ada model.h5 tapi TensorFlow belum terpasang: pip install tensorflow")

if model is None:
    print("[!] Model belum dipasang di folder backend/model/. Mode demo aktif (hasil acak).")


def preprocess(img):
    # Untuk model Keras. Sesuaikan dengan preprocessing saat training
    # (VGG16: tf.keras.applications.vgg16.preprocess_input)
    img = img.convert("RGB").resize(IMG_SIZE)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, 0)


def run_model(img):
    if model is None:
        return random.choice(CLASSES), round(random.uniform(0.7, 0.98), 4), True

    if model_jenis == "pytorch":
        with torch.no_grad():
            x = torch_tf(img.convert("RGB")).unsqueeze(0)
            probs = torch.softmax(model(x), dim=1)[0].tolist()
        # Tampilkan hasil asli model di Terminal (untuk pengecekan)
        urut = sorted(zip(TORCH_CLASSES, probs), key=lambda t: -t[1])[:3]
        print("[model] " + ", ".join(f"{n} {p:.0%}" for n, p in urut))
        skor = {}
        for nama, p in zip(TORCH_CLASSES, probs):
            label = PETA_TORCH.get(nama)
            if label:
                skor[label] = skor.get(label, 0) + p
        total = sum(skor.values()) or 1
        label = max(skor, key=skor.get)
        return label, round(skor[label] / total, 4), False

    probs = model.predict(preprocess(img), verbose=0)[0]
    print("[model] " + ", ".join(f"{c} {p:.0%}" for c, p in zip(CLASSES, probs)))
    i = int(np.argmax(probs))
    return CLASSES[i], float(probs[i]), False


# =========================================================
# Helper
# =========================================================
def err(msg, code=400):
    return jsonify({"error": msg}), code


def role_required(*roles):
    def deco(fn):
        @wraps(fn)
        @jwt_required()
        def wrapper(*a, **kw):
            if get_jwt().get("role") not in roles:
                return err("Halaman ini khusus " + " / ".join(roles) + ".", 403)
            return fn(*a, **kw)
        return wrapper
    return deco


def uid():
    return int(get_jwt_identity())


def my_role():
    return get_jwt().get("role")


def user_json(u):
    return {"id": u["id"], "nama": u["nama"], "email": u["email"], "role": u["role"], "lokasi": u["lokasi"]}


# Satu "entry" = satu hasil scan + konsultasi + pembayarannya.
# Bentuknya sama dengan yang dipakai frontend (hasil.js, riwayat.js, validator.js, admin.js).
ENTRY_SQL = """
SELECT s.id, s.user_id, s.image_path, s.label, s.confidence, s.demo, s.created_at,
       k.id AS k_id, k.status, k.catatan_user, k.dikirim, k.diagnosis, k.keparahan,
       k.pesan, k.divalidasi, k.dibaca, k.validator_nama,
       v.nama AS v_nama, u.nama AS u_nama, u.lokasi AS u_lokasi, u.email AS u_email,
       p.kode AS p_kode, p.jumlah AS p_jumlah, p.metode AS p_metode, p.status AS p_status,
       p.dibuat AS p_dibuat, p.dibayar AS p_dibayar
FROM scans s
JOIN users u ON u.id = s.user_id
LEFT JOIN konsultasi k ON k.scan_id = s.id
LEFT JOIN users v ON v.id = k.validator_id
LEFT JOIN pembayaran p ON p.scan_id = s.id
"""


def entry_json(r):
    e = {
        "id": r["id"],
        "tanggal": r["created_at"],
        "label": r["label"],
        "confidence": r["confidence"],
        "demo": bool(r["demo"]),
        "image": request.host_url.rstrip("/") + "/uploads/" + r["image_path"],
        "pengguna": {"nama": r["u_nama"], "email": r["u_email"], "lokasi": r["u_lokasi"] or ""},
        "konsultasi": None,
        "pembayaran": None,
    }
    if r["k_id"]:
        e["konsultasi"] = {
            "id": r["k_id"],
            "status": r["status"],
            "catatanUser": r["catatan_user"] or "",
            "dikirim": r["dikirim"],
            "diagnosis": r["diagnosis"],
            "keparahan": r["keparahan"],
            "pesan": r["pesan"],
            "validator": r["validator_nama"] or r["v_nama"],
            "divalidasi": r["divalidasi"],
            "dibaca": bool(r["dibaca"]),
            "pengguna": {"nama": r["u_nama"], "lokasi": r["u_lokasi"] or ""},
        }
    if r["p_kode"]:
        e["pembayaran"] = {
            "kode": r["p_kode"],
            "jumlah": r["p_jumlah"],
            "metode": METODE_BAYAR.get(r["p_metode"], r["p_metode"]),
            "status": r["p_status"],
            "dibuat": r["p_dibuat"],
            "dibayar": r["p_dibayar"],
        }
    return e


def get_entry_row(sid):
    return db().execute(ENTRY_SQL + " WHERE s.id=?", (sid,)).fetchone()


def own_entry(sid):
    """Entry milik user yang login. Validator & admin boleh melihat semua."""
    r = get_entry_row(sid)
    if not r or (r["user_id"] != uid() and my_role() not in ("validator", "admin")):
        return None
    return r


def hapus_file(names):
    for n in names:
        try:
            os.remove(os.path.join(UPLOAD_DIR, n))
        except OSError:
            pass


# =========================================================
# Data penyakit
# =========================================================
def semua_penyakit():
    """Dict key -> data penyakit (urut), termasuk field bisaScan."""
    out = {}
    for r in db().execute("SELECT * FROM penyakit ORDER BY bisa_scan DESC, urutan, key"):
        d = json.loads(r["data"])
        d["bisaScan"] = bool(r["bisa_scan"])
        out[r["key"]] = d
    return out


def diagnosis_valid():
    return set(CLASSES) | {r["key"] for r in db().execute("SELECT key FROM penyakit")} | {"lainnya"}


def nama_label(key):
    if key == "lainnya":
        return "Penyakit lain"
    r = db().execute("SELECT data FROM penyakit WHERE key=?", (key,)).fetchone()
    return json.loads(r["data"]).get("nama", key) if r else key


def bersihkan_penyakit(b):
    """Validasi dan rapikan isian form penyakit dari admin. Kembalikan (data, error)."""
    nama = (b.get("nama") or "").strip()
    if not nama:
        return None, "Nama penyakit wajib diisi."
    d = {
        "nama": nama[:80],
        "kategori": (b.get("kategori") or "").strip()[:40],
        "latin": (b.get("latin") or "").strip()[:160],
        "ringkasan": (b.get("ringkasan") or "").strip()[:800],
    }
    for f in FIELD_LIST:
        v = b.get(f) or []
        if isinstance(v, str):
            v = v.split("\n")
        d[f] = [x.strip()[:300] for x in v if x and x.strip()][:15]
    jenis = []
    for j in (b.get("jenis") or [])[:10]:
        if isinstance(j, dict) and (j.get("nama") or "").strip():
            jenis.append({"nama": j["nama"].strip()[:80], "latin": (j.get("latin") or "").strip()[:160],
                          "ciri": (j.get("ciri") or "").strip()[:400]})
    if jenis:
        d["jenis"] = jenis
    if not d["penanganan"]:
        return None, "Isi minimal satu langkah penanganan."
    return d, None


# =========================================================
# Email
# Diatur lewat file backend/pengaturan_email.json, contoh:
#   {"aktif": true, "host": "smtp.gmail.com", "port": 587,
#    "user": "emailkamu@gmail.com", "password": "app password 16 huruf",
#    "pengirim": "SiGura <emailkamu@gmail.com>", "url_web": "http://127.0.0.1:5000"}
# Kalau file tidak ada atau "aktif": false, email hanya ditampilkan di Terminal.
# =========================================================
def email_cfg():
    try:
        with open(EMAIL_CFG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def url_web(path=""):
    base = (email_cfg().get("url_web") or request.host_url).rstrip("/")
    return base + "/" + path.lstrip("/")


def email_html(judul, baris, tombol=None):
    isi = "".join(f'<p style="margin:0 0 12px">{b}</p>' for b in baris)
    btn = (f'<p style="margin:20px 0 0"><a href="{tombol[1]}" style="background:#1a8580;color:#fff;'
           f'padding:12px 22px;border-radius:99px;text-decoration:none;font-weight:bold">{tombol[0]}</a></p>'
           if tombol else "")
    return f"""<div style="font-family:Arial,sans-serif;background:#f5f9fa;padding:24px">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px;color:#15395d">
    <p style="margin:0 0 4px;color:#1a8580;font-weight:bold">SiGura</p>
    <h2 style="margin:0 0 16px;font-size:20px">{judul}</h2>{isi}{btn}
    <p style="margin:24px 0 0;font-size:12px;color:#6b84a6">Email ini dikirim otomatis oleh SiGura. Mohon tidak membalas email ini.</p>
  </div></div>"""


def kirim_email(ke, subjek, baris, tombol=None):
    """Kirim email di latar belakang. Tidak pernah membuat request gagal."""
    if not ke or ke.endswith(DUMMY_DOMAIN):
        return
    teks = "\n\n".join(htmllib.unescape(re.sub(r"<[^>]+>", "", b.replace("<br>", "\n"))) for b in baris)
    if tombol:
        teks += f"\n\n{tombol[0]}: {tombol[1]}"
    cfg = email_cfg()
    if not cfg.get("aktif"):
        print(f"\n[email - belum aktif, hanya ditampilkan]\nKe: {ke}\nSubjek: {subjek}\n{teks}\n")
        return
    html = email_html(subjek, baris, tombol)

    def _kirim():
        try:
            msg = EmailMessage()
            msg["Subject"] = subjek
            msg["From"] = cfg.get("pengirim") or cfg["user"]
            msg["To"] = ke
            msg.set_content(teks)
            msg.add_alternative(html, subtype="html")
            with smtplib.SMTP(cfg.get("host", "smtp.gmail.com"), int(cfg.get("port", 587)), timeout=20) as smtp:
                if cfg.get("tls", True):
                    smtp.starttls()
                if cfg.get("user"):
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
            print(f"[email] terkirim ke {ke}: {subjek}")
        except Exception as e:
            print(f"[email] GAGAL kirim ke {ke}: {e}")

    threading.Thread(target=_kirim, daemon=True).start()


def tgl_id(iso):
    bulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
             "September", "Oktober", "November", "Desember"]
    d = datetime.fromisoformat(iso).astimezone(timezone(timedelta(hours=7)))
    return f"{d.day} {bulan[d.month - 1]} {d.year} pukul {d:%H.%M} WIB"


def rupiah(n):
    return "Rp" + f"{int(n):,}".replace(",", ".")


# =========================================================
# Auth
# =========================================================
def buat_user(nama, email, pw, lokasi=None, role="pembudidaya"):
    """Kembalikan (user_id, pesan_error)."""
    nama, email = (nama or "").strip(), (email or "").strip().lower()
    lokasi = (lokasi or "").strip() or None
    if not nama or not email or not pw:
        return None, "Lengkapi nama, email, dan kata sandi."
    if "@" not in email:
        return None, "Format email belum benar."
    if len(pw) < 8:
        return None, "Kata sandi minimal 8 karakter."
    if role not in ROLES:
        return None, "Role tidak dikenal."
    try:
        cur = db().execute(
            "INSERT INTO users (nama,email,password_hash,role,lokasi,created_at) VALUES (?,?,?,?,?,?)",
            (nama, email, generate_password_hash(pw), role, lokasi, now()),
        )
        db().commit()
        return cur.lastrowid, None
    except sqlite3.IntegrityError:
        return None, "Email sudah terdaftar."


@app.post("/api/register")
def register():
    b = request.get_json(silent=True) or {}
    new_id, e = buat_user(b.get("nama"), b.get("email"), b.get("password") or "", b.get("lokasi"))
    if e:
        return err(e + (" Silakan masuk." if "terdaftar" in e else ""), 409 if "terdaftar" in e else 400)
    return jsonify({"message": "Akun dibuat."}), 201


@app.post("/api/login")
def login():
    b = request.get_json(silent=True) or {}
    email = (b.get("email") or "").strip().lower()
    pw = b.get("password") or ""
    u = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not u or not check_password_hash(u["password_hash"], pw):
        return err("Email atau kata sandi salah.", 401)
    token = create_access_token(identity=str(u["id"]), additional_claims={"role": u["role"]})
    return jsonify({"token": token, "user": user_json(u)})


@app.get("/api/me")
@jwt_required()
def me():
    """Profil akun yang login + statistik singkat sesuai role."""
    u = db().execute("SELECT * FROM users WHERE id=?", (uid(),)).fetchone()
    if not u:
        return err("Akun tidak ditemukan.", 404)
    one = lambda q: db().execute(q, (uid(),)).fetchone()[0]  # noqa: E731
    if u["role"] == "validator":
        stat = {
            "validasi": one("SELECT COUNT(*) FROM konsultasi WHERE validator_id=? AND status='selesai'"),
            "sesuai": one("""SELECT COUNT(*) FROM konsultasi k JOIN scans s ON s.id=k.scan_id
                             WHERE k.validator_id=? AND k.status='selesai' AND k.diagnosis=s.label"""),
            "bulan_ini": one("""SELECT COUNT(*) FROM konsultasi WHERE validator_id=? AND status='selesai'
                                AND substr(divalidasi,1,7)=strftime('%Y-%m','now')"""),
        }
        stat["dikoreksi"] = stat["validasi"] - stat["sesuai"]
    else:
        stat = {
            "scan": one("SELECT COUNT(*) FROM scans WHERE user_id=?"),
            "konsultasi": one("SELECT COUNT(*) FROM konsultasi k JOIN scans s ON s.id=k.scan_id WHERE s.user_id=?"),
            "divalidasi": one("""SELECT COUNT(*) FROM konsultasi k JOIN scans s ON s.id=k.scan_id
                                 WHERE s.user_id=? AND k.status='selesai'"""),
        }
    return jsonify({**user_json(u), "created_at": u["created_at"], "statistik": stat})


@app.put("/api/me")
@jwt_required()
def ubah_profil():
    b = request.get_json(silent=True) or {}
    nama = (b.get("nama") or "").strip()[:80]
    email = (b.get("email") or "").strip().lower()[:120]
    lokasi = (b.get("lokasi") or "").strip()[:80] or None
    if not nama or not email:
        return err("Nama dan email wajib diisi.")
    if "@" not in email or "." not in email.split("@")[-1]:
        return err("Format email belum benar.")
    try:
        db().execute("UPDATE users SET nama=?, email=?, lokasi=? WHERE id=?", (nama, email, lokasi, uid()))
        db().commit()
    except sqlite3.IntegrityError:
        return err("Email sudah dipakai akun lain.", 409)
    u = db().execute("SELECT * FROM users WHERE id=?", (uid(),)).fetchone()
    return jsonify(user_json(u))


@app.put("/api/me/password")
@jwt_required()
def ubah_password():
    b = request.get_json(silent=True) or {}
    lama, baru = b.get("lama") or "", b.get("baru") or ""
    u = db().execute("SELECT password_hash FROM users WHERE id=?", (uid(),)).fetchone()
    if not u or not check_password_hash(u["password_hash"], lama):
        return err("Kata sandi lama salah.")
    if len(baru) < 8:
        return err("Kata sandi baru minimal 8 karakter.")
    if baru == lama:
        return err("Kata sandi baru harus berbeda dari yang lama.")
    db().execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(baru), uid()))
    db().commit()
    return jsonify({"message": "Kata sandi diperbarui."})


# =========================================================
# Prediksi
# =========================================================
@app.post("/predict")
def predict():
    f = request.files.get("file")
    if not f:
        return err("Tidak ada file. Kirim dengan field 'file'.")
    if f.mimetype not in ALLOWED_MIME:
        return err("Format file tidak didukung. Gunakan JPG atau PNG.")
    data = f.read()
    if len(data) > MAX_SIZE:
        return err("Ukuran foto lebih dari 5 MB.")
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        return err("File bukan gambar yang valid.")

    label, conf, demo = run_model(img)

    # Disimpan ke riwayat kalau user login
    scan_id = None
    verify_jwt_in_request(optional=True)
    if get_jwt_identity():
        name = f"{uuid.uuid4().hex}.jpg"
        im = img.convert("RGB")
        im.thumbnail((1200, 1200))
        im.save(os.path.join(UPLOAD_DIR, name), "JPEG", quality=85)
        cur = db().execute(
            "INSERT INTO scans (user_id,image_path,label,confidence,demo,created_at) VALUES (?,?,?,?,?,?)",
            (uid(), name, label, conf, int(demo), now()),
        )
        db().commit()
        scan_id = cur.lastrowid

    return jsonify({"label": label, "confidence": conf, "demo": demo, "scan_id": scan_id})


@app.get("/uploads/<path:name>")
def uploads(name):
    return send_from_directory(UPLOAD_DIR, name)


# =========================================================
# Riwayat scan (milik user yang login)
# =========================================================
@app.get("/api/scans")
@jwt_required()
def list_scans():
    rows = db().execute(ENTRY_SQL + " WHERE s.user_id=? ORDER BY s.created_at DESC", (uid(),)).fetchall()
    return jsonify([entry_json(r) for r in rows])


@app.get("/api/scans/<int:sid>")
@jwt_required()
def get_scan(sid):
    r = own_entry(sid)
    return jsonify(entry_json(r)) if r else err("Hasil scan tidak ditemukan.", 404)


@app.delete("/api/scans/<int:sid>")
@jwt_required()
def delete_scan(sid):
    s = db().execute("SELECT image_path FROM scans WHERE id=? AND user_id=?", (sid, uid())).fetchone()
    if not s:
        return err("Riwayat tidak ditemukan.", 404)
    db().execute("DELETE FROM scans WHERE id=?", (sid,))
    db().commit()
    hapus_file([s["image_path"]])
    return jsonify({"message": "Dihapus"})


@app.delete("/api/scans")
@jwt_required()
def delete_all_scans():
    files = [r["image_path"] for r in db().execute("SELECT image_path FROM scans WHERE user_id=?", (uid(),))]
    db().execute("DELETE FROM scans WHERE user_id=?", (uid(),))
    db().commit()
    hapus_file(files)
    return jsonify({"message": "Semua riwayat dihapus"})


# =========================================================
# Konsultasi + pembayaran (sisi pembudidaya)
# Alur (sesuai SRS): ajukan validasi -> bayar -> diteruskan ke validator
# =========================================================
@app.get("/api/tarif")
def tarif():
    return jsonify({"jumlah": TARIF_VALIDASI, "metode": METODE_BAYAR,
                    "estimasi": ESTIMASI_VALIDASI, "ketentuan": KETENTUAN_VALIDASI})


@app.post("/api/scans/<int:sid>/konsultasi")
@jwt_required()
def ajukan_konsultasi(sid):
    s = db().execute("SELECT id FROM scans WHERE id=? AND user_id=?", (sid, uid())).fetchone()
    if not s:
        return err("Hasil scan tidak ditemukan.", 404)
    catatan = ((request.get_json(silent=True) or {}).get("catatan") or "").strip()[:500]
    try:
        db().execute("INSERT INTO konsultasi (scan_id,catatan_user,status,dikirim) VALUES (?,?,'menunggu_bayar',?)",
                     (sid, catatan, now()))
        db().commit()
    except sqlite3.IntegrityError:
        return err("Konsultasi untuk hasil ini sudah diajukan.", 409)
    return jsonify(entry_json(get_entry_row(sid))), 201


@app.post("/api/scans/<int:sid>/transaksi")
@jwt_required()
def buat_transaksi(sid):
    """Langkah 'Pilih metode pembayaran' -> sistem membuat transaksi (kode baru tiap percobaan)."""
    metode = (request.get_json(silent=True) or {}).get("metode")
    if metode not in METODE_BAYAR:
        return err("Pilih metode pembayaran.")
    k = db().execute("""SELECT k.status FROM konsultasi k JOIN scans s ON s.id = k.scan_id
                        WHERE k.scan_id=? AND s.user_id=?""", (sid, uid())).fetchone()
    if not k:
        return err("Ajukan validasi dulu sebelum membayar.", 404)
    if k["status"] != "menunggu_bayar":
        return err("Validasi ini sudah dibayar.", 409)
    if db().execute("SELECT 1 FROM pembayaran WHERE scan_id=?", (sid,)).fetchone():
        db().execute("""UPDATE pembayaran SET kode=?, metode=?, status='menunggu', dibuat=?, dibayar=NULL
                        WHERE scan_id=?""", (kode_transaksi(), metode, now(), sid))
    else:
        db().execute("INSERT INTO pembayaran (scan_id,kode,jumlah,metode,status,dibuat) VALUES (?,?,?,?,'menunggu',?)",
                     (sid, kode_transaksi(), TARIF_VALIDASI, metode, now()))
    db().commit()
    return jsonify(entry_json(get_entry_row(sid)))


@app.post("/api/scans/<int:sid>/bayar")
@jwt_required()
def bayar(sid):
    """Simulasi payment gateway. hasil = "berhasil" atau "gagal" (belum payment gateway asli)."""
    hasil = (request.get_json(silent=True) or {}).get("hasil", "berhasil")
    p = db().execute("""SELECT p.status FROM pembayaran p JOIN scans s ON s.id = p.scan_id
                        WHERE p.scan_id=? AND s.user_id=?""", (sid, uid())).fetchone()
    if not p:
        return err("Transaksi tidak ditemukan. Pilih metode pembayaran dulu.", 404)
    if p["status"] == "lunas":
        return err("Transaksi ini sudah dibayar.", 409)
    if p["status"] == "gagal":
        return err("Transaksi ini gagal. Silakan coba lagi.", 409)

    if hasil == "gagal":
        db().execute("UPDATE pembayaran SET status='gagal' WHERE scan_id=?", (sid,))
        db().commit()
        return jsonify(entry_json(get_entry_row(sid)))

    db().execute("UPDATE pembayaran SET status='lunas', dibayar=? WHERE scan_id=?", (now(), sid))
    db().execute("UPDATE konsultasi SET status='menunggu', dikirim=? WHERE scan_id=?", (now(), sid))
    db().commit()
    r = get_entry_row(sid)
    e = entry_json(r)

    # Email bukti pembayaran ke pengguna
    esc = htmllib.escape
    kirim_email(r["u_email"], "Pembayaran berhasil, konsultasi diteruskan ke penyuluh", [
        f"Halo {esc(r['u_nama'])},",
        f"Pembayaran layanan validasi sebesar <b>{rupiah(r['p_jumlah'])}</b> via {e['pembayaran']['metode']} "
        f"berhasil (kode transaksi <b>{r['p_kode']}</b>).",
        f"Hasil scan kamu sudah diteruskan ke penyuluh perikanan. Estimasi waktu: {ESTIMASI_VALIDASI.lower()}. "
        "Kami akan mengirim email lagi saat hasil validasi keluar.",
    ], ("Lihat status", url_web(f"hasil.html?id={sid}")))

    # Notifikasi ke semua validator: ada pemeriksaan baru
    for v in db().execute("SELECT email, nama FROM users WHERE role='validator'"):
        kirim_email(v["email"], "Konsultasi baru menunggu validasi", [
            f"Halo {esc(v['nama'].split(',')[0])},",
            f"Ada konsultasi baru dari <b>{esc(r['u_nama'])}</b>{' (' + esc(r['u_lokasi']) + ')' if r['u_lokasi'] else ''}. "
            f"Hasil model: {nama_label(r['label'])} ({round(r['confidence'] * 100)}%).",
            f"Catatan pembudidaya: {esc(r['catatan_user'] or '-')}",
        ], ("Buka antrian konsultasi", url_web("validator.html")))
    return jsonify(e)


@app.get("/api/validator/riwayat")
@role_required("validator")
def riwayat_validasi():
    """Riwayat validasi yang sudah dilakukan validator yang login."""
    rows = db().execute(ENTRY_SQL + " WHERE k.validator_id=? AND k.status='selesai' ORDER BY k.divalidasi DESC",
                        (uid(),)).fetchall()
    return jsonify([entry_json(r) for r in rows])


@app.get("/api/validator/notifikasi")
@role_required("validator")
def notifikasi_validator():
    n = db().execute("SELECT COUNT(*) FROM konsultasi WHERE status='menunggu'").fetchone()[0]
    return jsonify({"menunggu": n})


@app.patch("/api/scans/<int:sid>/dibaca")
@jwt_required()
def tandai_dibaca(sid):
    db().execute("""
        UPDATE konsultasi SET dibaca=1
        WHERE scan_id=? AND scan_id IN (SELECT id FROM scans WHERE user_id=?)
    """, (sid, uid()))
    db().commit()
    return jsonify({"message": "OK"})


@app.get("/api/notifikasi")
@jwt_required()
def notifikasi():
    n = db().execute("""
        SELECT COUNT(*) FROM konsultasi k JOIN scans s ON s.id = k.scan_id
        WHERE s.user_id=? AND k.status='selesai' AND k.dibaca=0
    """, (uid(),)).fetchone()[0]
    return jsonify({"balasan_baru": n})


# =========================================================
# Validator (hanya konsultasi yang sudah dibayar - BR-04)
# =========================================================
@app.get("/api/konsultasi")
@role_required("validator", "admin")
def semua_konsultasi():
    rows = db().execute(ENTRY_SQL + " WHERE k.status IN ('menunggu','selesai') ORDER BY k.dikirim").fetchall()
    return jsonify([entry_json(r) for r in rows])


@app.put("/api/scans/<int:sid>/validasi")
@role_required("validator")
def validasi(sid):
    b = request.get_json(silent=True) or {}
    diagnosis = b.get("diagnosis")
    keparahan = b.get("keparahan")
    pesan = (b.get("pesan") or "").strip()
    nama = (b.get("validator_nama") or "").strip()

    kurang = []
    if diagnosis not in diagnosis_valid():
        kurang.append("diagnosis")
    if diagnosis != "sehat" and keparahan not in ("ringan", "sedang", "berat"):
        kurang.append("tingkat keparahan")
    if not pesan:
        kurang.append("rekomendasi penanganan")
    if not nama:
        kurang.append("nama validator")
    if kurang:
        return err("Lengkapi dulu: " + ", ".join(kurang) + ".")

    cur = db().execute("""
        UPDATE konsultasi SET status='selesai', diagnosis=?, keparahan=?, pesan=?,
               validator_id=?, validator_nama=?, divalidasi=?, dibaca=0
        WHERE scan_id=? AND status IN ('menunggu','selesai')
    """, (diagnosis, None if diagnosis == "sehat" else keparahan, pesan, uid(), nama, now(), sid))
    db().commit()
    if not cur.rowcount:
        return err("Konsultasi tidak ditemukan atau belum dibayar.", 404)
    r = get_entry_row(sid)

    # Email hasil validasi ke pengguna
    esc = htmllib.escape
    kep = f" (keparahan {r['keparahan']})" if r["keparahan"] else ""
    baris = [
        f"Halo {esc(r['u_nama'])},",
        f"Penyuluh sudah memeriksa hasil scan kamu tanggal {tgl_id(r['created_at'])}.",
        f"Diagnosis: <b>{nama_label(diagnosis)}</b>{kep}",
    ]
    if diagnosis != r["label"]:
        baris.append(f"Catatan: penyuluh mengoreksi hasil model dari {nama_label(r['label'])} "
                     f"menjadi {nama_label(diagnosis)}.")
    baris.append("Rekomendasi penanganan khusus:<br>" + esc(pesan).replace("\n", "<br>"))
    baris.append(f"Divalidasi oleh {esc(nama)}.")
    kirim_email(r["u_email"], "Hasil validasi SiGura sudah keluar", baris,
                ("Lihat hasil lengkap", url_web(f"hasil.html?id={sid}")))
    return jsonify(entry_json(r))


# ---------- Data contoh untuk halaman validator ----------
def gambar_dummy(jenis):
    """Ilustrasi ikan sederhana supaya data contoh punya foto."""
    im = Image.new("RGB", (480, 320), "#e7f1f4")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 268, 480, 320], fill="#d3e6ec")
    d.polygon([(85, 160), (24, 100), (40, 160), (24, 220)], fill="#6f7f92")        # ekor
    d.polygon([(190, 95), (240, 45), (320, 60), (345, 120)], fill="#6f7f92")      # sirip atas
    d.polygon([(195, 225), (235, 272), (300, 265), (325, 215)], fill="#6f7f92")   # sirip bawah
    d.ellipse([70, 65, 420, 260] if jenis == "kembung" else [70, 88, 420, 236], fill="#8c9bab")
    rnd = random.Random(jenis)
    if jenis == "bakteri":
        for x, y, rx, ry in [(220, 150, 30, 18), (285, 185, 18, 12), (165, 185, 14, 9), (330, 130, 12, 8)]:
            d.ellipse([x - rx, y - ry, x + rx, y + ry], fill="#c4473d")
    elif jenis == "white_spot":
        for _ in range(45):
            x, y, r = rnd.randint(110, 370), rnd.randint(110, 215), rnd.randint(2, 4)
            d.ellipse([x - r, y - r, x + r, y + r], fill="white")
    elif jenis == "jamur":
        for cx, cy in [(140, 110), (260, 190)]:
            for _ in range(7):
                x, y, r = cx + rnd.randint(-18, 18), cy + rnd.randint(-12, 12), rnd.randint(8, 14)
                d.ellipse([x - r, y - r, x + r, y + r], fill="#f4f7f8")
    elif jenis == "kutu_ikan":
        for x, y in [(190, 140), (290, 175), (240, 120)]:
            d.ellipse([x - 9, y - 6, x + 9, y + 6], fill="#7a6a3a")
        for x, y in [(210, 180), (265, 145), (170, 170)]:
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill="#c4473d")
    d.ellipse([366, 140, 386, 160], fill="white")
    d.ellipse([372, 144, 384, 156], fill="#1c2b3a")
    name = f"contoh-{uuid.uuid4().hex[:10]}.jpg"
    im.save(os.path.join(UPLOAD_DIR, name), "JPEG", quality=90)
    return name


CONTOH = [
    {"nama": "Pak Slamet", "lokasi": "Tulungagung", "label": "bakteri", "conf": 0.88, "jam": 2,
     "catatan": "Ada 6 ikan dengan luka merah di badan, 2 ikan sudah mati kemarin. Air kolam agak keruh."},
    {"nama": "Bu Rini", "lokasi": "Blitar", "label": "jamur", "conf": 0.71, "jam": 5, "foto": "white_spot",
     "catatan": "Bintik putih makin banyak sejak cuaca dingin. Ikan sering menggesekkan badan ke dinding kolam."},
    {"nama": "Mas Dodi", "lokasi": "Sidoarjo", "label": "jamur", "conf": 0.84, "jam": 26,
     "catatan": "Muncul lapisan putih di sirip setelah sortir panen minggu lalu."},
    {"nama": "Pak Hadi", "lokasi": "Kediri", "label": "bakteri", "conf": 0.91, "jam": 50, "foto": "kembung",
     "catatan": "Perut ikan membesar, sisik berdiri, ikan diam di dasar kolam.",
     "validasi": ("bakteri", "berat",
                  "Gejala mengarah ke infeksi bakteri (dropsy).\n1. Segera pisahkan ikan yang perutnya membesar.\n2. Ganti sepertiga air kolam dan hentikan pakan 1 hari.\n3. Hubungi saya untuk pemeriksaan langsung minggu ini.")},
    {"nama": "Bu Wati", "lokasi": "Lamongan", "label": "bakteri", "conf": 0.72, "jam": 74, "foto": "kutu_ikan",
     "catatan": "Ada titik merah kecil di kulit, ikan gelisah dan sering loncat.",
     "validasi": ("kutu_ikan", "sedang",
                  "Dari foto terlihat kutu ikan (Argulus), bukan infeksi bakteri.\n1. Cabut kutu yang terlihat dengan pinset.\n2. Rendam ikan dengan larutan garam ikan sesuai dosis anjuran.\n3. Kuras dan keringkan kolam setelah panen.")},
]


@app.post("/api/dev/seed")
@role_required("validator", "admin")
def seed():
    c = db()
    lama = c.execute("""SELECT s.image_path FROM scans s JOIN users u ON u.id=s.user_id
                        WHERE u.email LIKE ?""", ("%" + DUMMY_DOMAIN,)).fetchall()
    c.execute("DELETE FROM users WHERE email LIKE ?", ("%" + DUMMY_DOMAIN,))
    hapus_file([r["image_path"] for r in lama])

    validator = c.execute("SELECT id FROM users WHERE role='validator' ORDER BY id LIMIT 1").fetchone()
    pw = generate_password_hash(uuid.uuid4().hex)
    for i, x in enumerate(CONTOH):
        u = c.execute("INSERT INTO users (nama,email,password_hash,lokasi,created_at) VALUES (?,?,?,?,?)",
                      (x["nama"], f"contoh{i}{DUMMY_DOMAIN}", pw, x["lokasi"], now(200)))
        s = c.execute("INSERT INTO scans (user_id,image_path,label,confidence,demo,created_at) VALUES (?,?,?,?,?,?)",
                      (u.lastrowid, gambar_dummy(x.get("foto", x["label"])), x["label"], x["conf"], 0, now(x["jam"] + 0.2)))
        sid = s.lastrowid
        c.execute("INSERT INTO pembayaran (scan_id,kode,jumlah,metode,status,dibuat,dibayar) VALUES (?,?,?,?,?,?,?)",
                  (sid, kode_transaksi(), TARIF_VALIDASI, random.choice(list(METODE_BAYAR)), "lunas",
                   now(x["jam"] + 0.1), now(x["jam"])))
        if "validasi" in x:
            diag, kep, pesan = x["validasi"]
            c.execute("""INSERT INTO konsultasi (scan_id,catatan_user,status,diagnosis,keparahan,pesan,
                         validator_id,validator_nama,dikirim,divalidasi,dibaca)
                         VALUES (?,?,'selesai',?,?,?,?,?,?,?,1)""",
                      (sid, x["catatan"], diag, kep, pesan, validator["id"] if validator else None,
                       "Budi, Penyuluh Perikanan Kediri", now(x["jam"]), now(x["jam"] - 3)))
        else:
            c.execute("INSERT INTO konsultasi (scan_id,catatan_user,status,dikirim) VALUES (?,?,'menunggu',?)",
                      (sid, x["catatan"], now(x["jam"])))
    c.commit()
    return jsonify({"message": "Data contoh dimuat."})


# =========================================================
# Admin / pengelola
# =========================================================
@app.get("/api/admin/ringkasan")
@role_required("admin")
def admin_ringkasan():
    c = db()
    one = lambda q, *a: c.execute(q, a).fetchone()[0]  # noqa: E731
    return jsonify({
        "pembudidaya": one("SELECT COUNT(*) FROM users WHERE role='pembudidaya' AND email NOT LIKE ?", "%" + DUMMY_DOMAIN),
        "validator": one("SELECT COUNT(*) FROM users WHERE role='validator'"),
        "admin": one("SELECT COUNT(*) FROM users WHERE role='admin'"),
        "pemeriksaan": one("SELECT COUNT(*) FROM scans"),
        "hasil": {r["label"]: r["n"] for r in c.execute("SELECT label, COUNT(*) n FROM scans GROUP BY label")},
        "konsultasi_menunggu": one("SELECT COUNT(*) FROM konsultasi WHERE status='menunggu'"),
        "konsultasi_selesai": one("SELECT COUNT(*) FROM konsultasi WHERE status='selesai'"),
        "transaksi_lunas": one("SELECT COUNT(*) FROM pembayaran WHERE status='lunas'"),
        "transaksi_menunggu": one("SELECT COUNT(*) FROM pembayaran WHERE status='menunggu'"),
        "pendapatan": one("SELECT COALESCE(SUM(jumlah),0) FROM pembayaran WHERE status='lunas'"),
        "model": model_jenis,
    })


@app.get("/api/admin/users")
@role_required("admin")
def admin_users():
    rows = db().execute("""
        SELECT u.*, (SELECT COUNT(*) FROM scans s WHERE s.user_id=u.id) AS jumlah_scan,
               (SELECT COUNT(*) FROM konsultasi k WHERE k.validator_id=u.id) AS jumlah_validasi
        FROM users u ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'validator' THEN 1 ELSE 2 END, u.created_at DESC
    """).fetchall()
    return jsonify([{**user_json(r), "created_at": r["created_at"], "jumlah_scan": r["jumlah_scan"],
                     "jumlah_validasi": r["jumlah_validasi"], "contoh": r["email"].endswith(DUMMY_DOMAIN)}
                    for r in rows])


@app.post("/api/admin/users")
@role_required("admin")
def admin_tambah_user():
    b = request.get_json(silent=True) or {}
    new_id, e = buat_user(b.get("nama"), b.get("email"), b.get("password") or "", b.get("lokasi"),
                          b.get("role") or "validator")
    if e:
        return err(e, 409 if "terdaftar" in e else 400)
    return jsonify({"message": "Akun dibuat.", "id": new_id}), 201


@app.patch("/api/admin/users/<int:user_id>")
@role_required("admin")
def admin_ubah_user(user_id):
    b = request.get_json(silent=True) or {}
    if user_id == uid():
        return err("Tidak bisa mengubah role akun sendiri.")
    role = b.get("role")
    if role not in ROLES:
        return err("Role tidak dikenal.")
    cur = db().execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
    db().commit()
    return jsonify({"message": "Role diperbarui."}) if cur.rowcount else err("Akun tidak ditemukan.", 404)


@app.delete("/api/admin/users/<int:user_id>")
@role_required("admin")
def admin_hapus_user(user_id):
    if user_id == uid():
        return err("Tidak bisa menghapus akun sendiri.")
    files = [r["image_path"] for r in db().execute("SELECT image_path FROM scans WHERE user_id=?", (user_id,))]
    db().execute("UPDATE konsultasi SET validator_id=NULL WHERE validator_id=?", (user_id,))
    cur = db().execute("DELETE FROM users WHERE id=?", (user_id,))
    db().commit()
    hapus_file(files)
    return jsonify({"message": "Akun dihapus."}) if cur.rowcount else err("Akun tidak ditemukan.", 404)


@app.get("/api/admin/pemeriksaan")
@role_required("admin")
def admin_pemeriksaan():
    rows = db().execute(ENTRY_SQL + " ORDER BY s.created_at DESC LIMIT 300").fetchall()
    return jsonify([entry_json(r) for r in rows])


@app.get("/api/admin/transaksi")
@role_required("admin")
def admin_transaksi():
    rows = db().execute(ENTRY_SQL + " WHERE p.id IS NOT NULL ORDER BY p.dibuat DESC").fetchall()
    return jsonify([entry_json(r) for r in rows])


@app.get("/api/penyakit")
def daftar_penyakit():
    return jsonify(semua_penyakit())


@app.get("/api/penyakit.js")
def penyakit_js():
    """Dimuat halaman web sebelum data.js, supaya ensiklopedia memakai data dari database."""
    body = "window.PENYAKIT_DB = " + json.dumps(semua_penyakit(), ensure_ascii=False) + ";"
    return app.response_class(body, mimetype="application/javascript", headers={"Cache-Control": "no-store"})


@app.post("/api/admin/penyakit")
@role_required("admin")
def admin_tambah_penyakit():
    b = request.get_json(silent=True) or {}
    key = re.sub(r"[^a-z0-9]+", "_", (b.get("key") or b.get("nama") or "").strip().lower()).strip("_")[:40]
    if not key:
        return err("Kode penyakit tidak valid.")
    if key == "lainnya" or db().execute("SELECT 1 FROM penyakit WHERE key=?", (key,)).fetchone():
        return err(f"Kode '{key}' sudah dipakai. Gunakan nama atau kode lain.", 409)
    d, e = bersihkan_penyakit(b)
    if e:
        return err(e)
    urutan = db().execute("SELECT COALESCE(MAX(urutan),0)+1 FROM penyakit").fetchone()[0]
    # Penyakit baru tidak bisa dideteksi model (model hanya mengenal CLASSES)
    db().execute("INSERT INTO penyakit (key,urutan,bisa_scan,data,diubah) VALUES (?,?,0,?,?)",
                 (key, urutan, json.dumps(d, ensure_ascii=False), now()))
    db().commit()
    return jsonify({"message": "Penyakit ditambahkan.", "key": key}), 201


@app.put("/api/admin/penyakit/<key>")
@role_required("admin")
def admin_ubah_penyakit(key):
    r = db().execute("SELECT data FROM penyakit WHERE key=?", (key,)).fetchone()
    if not r:
        return err("Penyakit tidak ditemukan.", 404)
    d, e = bersihkan_penyakit(request.get_json(silent=True) or {})
    if e:
        return err(e)
    foto = json.loads(r["data"]).get("foto")
    if foto:
        d["foto"] = foto
    db().execute("UPDATE penyakit SET data=?, diubah=? WHERE key=?", (json.dumps(d, ensure_ascii=False), now(), key))
    db().commit()
    return jsonify({"message": "Penyakit diperbarui."})


@app.post("/api/admin/penyakit/<key>/foto")
@role_required("admin")
def admin_foto_penyakit(key):
    r = db().execute("SELECT data FROM penyakit WHERE key=?", (key,)).fetchone()
    if not r:
        return err("Penyakit tidak ditemukan.", 404)
    f = request.files.get("file")
    if not f or f.mimetype not in ALLOWED_MIME:
        return err("Pilih foto JPG atau PNG.")
    try:
        img = Image.open(BytesIO(f.read()))
        img.load()
    except (UnidentifiedImageError, OSError):
        return err("File bukan gambar yang valid.")
    d = json.loads(r["data"])
    lama = d.get("foto", "")
    name = f"penyakit-{key}-{uuid.uuid4().hex[:6]}.jpg"
    im = img.convert("RGB")
    im.thumbnail((1000, 1000))
    im.save(os.path.join(UPLOAD_DIR, name), "JPEG", quality=85)
    d["foto"] = "uploads/" + name
    db().execute("UPDATE penyakit SET data=?, diubah=? WHERE key=?", (json.dumps(d, ensure_ascii=False), now(), key))
    db().commit()
    if lama.startswith("uploads/"):
        hapus_file([lama.split("/", 1)[1]])
    return jsonify({"message": "Foto diperbarui.", "foto": d["foto"]})


@app.delete("/api/admin/penyakit/<key>")
@role_required("admin")
def admin_hapus_penyakit(key):
    if key in CLASSES:
        return err("Kelas yang dideteksi model (sehat, bakteri, jamur) tidak bisa dihapus.")
    r = db().execute("SELECT data FROM penyakit WHERE key=?", (key,)).fetchone()
    if not r:
        return err("Penyakit tidak ditemukan.", 404)
    db().execute("DELETE FROM penyakit WHERE key=?", (key,))
    db().commit()
    foto = json.loads(r["data"]).get("foto", "")
    if foto.startswith("uploads/"):
        hapus_file([foto.split("/", 1)[1]])
    return jsonify({"message": "Penyakit dihapus."})


# =========================================================
@app.errorhandler(413)
def too_large(_):
    return err("Ukuran foto lebih dari 5 MB.", 413)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "model": model_jenis, "classes": CLASSES})


# =========================================================
# Frontend: web dibuka langsung dari backend (tanpa Live Server)
# Buka di browser: http://127.0.0.1:5000
# =========================================================
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))


@app.get("/")
def halaman_utama():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:path>")
def file_frontend(path):
    return send_from_directory(FRONTEND_DIR, path)


init_db()  # dipanggil juga saat pakai `flask run` / gunicorn

if __name__ == "__main__":
    app.run(debug=True, port=5000)
