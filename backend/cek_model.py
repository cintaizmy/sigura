"""
Cek hasil model web = hasil di notebook.
Jalankan:  python cek_model.py foto1.jpg foto2.jpg ...
Lalu bandingkan angkanya dengan hasil prediksi di notebook Renata untuk foto yang sama.
"""
import sys

from PIL import Image

import app

if not app.models:
    sys.exit("Model belum dimuat. Cek pesan di atas (file .keras / TensorFlow).")
if len(sys.argv) < 2:
    sys.exit("Contoh: python cek_model.py uji1.jpg uji2.jpg")

for path in sys.argv[1:]:
    p, per_model = app.prediksi_ensemble(Image.open(path))
    print(f"\n{path}")
    for nama, q in per_model.items():
        print(f"  {nama:15s} " + "  ".join(f"{c} {v:.4f}" for c, v in zip(app.CLASSES, q)))
    print(f"  {'ENSEMBLE':15s} " + "  ".join(f"{c} {v:.4f}" for c, v in zip(app.CLASSES, p)))
    print(f"  Hasil akhir: {app.CLASSES[int(p.argmax())]}")
