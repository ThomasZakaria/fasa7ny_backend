import io
import json
from pathlib import Path
from typing import Dict, Any, Optional, List

import numpy as np
import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import albumentations as A
from albumentations.pytorch import ToTensorV2
import faiss
import pandas as pd

from model_utils import load_checkpoint, get_feature_extractor

# الإعدادات الأساسية
MODEL_CKPT = "models/best_landmarks.pt"
FAISS_INDEX = "models/faiss.index"
FAISS_META = "models/faiss_meta.json"

DATASET_DIR = Path("dataset").resolve()
WEB_DIR = Path("web").resolve()
INFO_CSV = Path("glvd2_info.csv").resolve()

TOPK_PRED = 5
TOPK_SIM = 8
REC_K = 6

app = FastAPI(title="Egypt Landmarks AI")

# تفعيل CORS للسماح لـ Node.js بالاتصال بالسيرفر
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model, img_size, class_names, model_name = load_checkpoint(MODEL_CKPT, device=device)
feat_model = get_feature_extractor(model).to(device).eval()

index = faiss.read_index(FAISS_INDEX)
with open(FAISS_META, "r", encoding="utf-8") as f:
    meta_db = json.load(f)["meta"]

tfm = A.Compose([
    A.Resize(img_size, img_size),
    A.Normalize(),
    ToTensorV2(),
])

# ---------- Load info CSV ----------
INFO_TABLE: Optional[pd.DataFrame] = None
INFO_LOOKUP: Dict[str, Dict[str, Any]] = {}

def _norm(s: str) -> str:
    return (s or "").strip().lower().replace(" ", "_")

def _pick_first(row: pd.Series, candidates: List[str]) -> str:
    for c in candidates:
        if c in row and pd.notna(row[c]):
            v = str(row[c]).strip()
            if v and v.lower() != "nan":
                return v
    return ""

def load_info():
    global INFO_TABLE, INFO_LOOKUP
    if not INFO_CSV.exists():
        return
    try:
        df = pd.read_csv(INFO_CSV, encoding="utf-8", low_memory=False)
    except Exception:
        df = pd.read_csv(INFO_CSV, encoding="latin-1", low_memory=False)

    INFO_TABLE = df
    possible_name_cols = ["class", "place", "landmark", "name", "Landmark Name (English)"]
    name_col = next((c for c in possible_name_cols if c in df.columns), None)

    if name_col:
        for _, r in df.iterrows():
            nm = str(r[name_col]).strip()
            if nm:
                INFO_LOOKUP[_norm(nm)] = {
                    "name": nm,
                    "arabic_name": _pick_first(r, ["arabic", "arabic_name", "Arabic Name"]),
                    "city": _pick_first(r, ["city", "location", "Location"]),
                    "brief": _pick_first(r, ["brief", "description", "Short History"]),
                }

load_info()

# ---------- API Logic ----------



@app.get("/recommend")
def recommend(place: str, k: int = REC_K):
    """
    توليد توصيات ذكية بناءً على التشابه المعماري في قاعدة بيانات FAISS
    """
    # 1. تنظيف الاسم للبحث (مثلاً: "Khan el-Khalili" -> "khan_el-khalili")
    target_clean = _norm(place)
    
    # 2. البحث عن المكان في قاعدة البيانات الوصفية (Meta DB)
    place_indices = [
        i for i, m in enumerate(meta_db) 
        if target_clean in m["class"].lower().replace(" ", "_")
    ]
    
    if not place_indices:
        print(f"⚠️ AI Similarity: No samples found for '{place}'")
        return {"place": place, "recommendations": []}

    # اختيار عينة عشوائية من الصور للمكان الحالي للبحث عن أشباهها
    sample = place_indices[: min(10, len(place_indices))]
    counts: Dict[str, int] = {}
    example_img: Dict[str, str] = {}

    for idx in sample:
        try:
            # محاولة استرجاع المتجه الرقمي للصورة
            v = np.zeros((1, index.d), dtype="float32")
            index.reconstruct(idx, v[0]) 
            D, I = index.search(v, 40)

            for j in I[0].tolist():
                if j < 0: continue
                c = meta_db[j]["class"]
                
                # تجنب ترشيح نفس المكان الذي نبحث عنه حالياً
                if _norm(c) == target_clean:
                    continue
                
                counts[c] = counts.get(c, 0) + 1
                if c not in example_img:
                    rel = str(Path(meta_db[j]["path"]).resolve().relative_to(DATASET_DIR)).replace("\\", "/")
                    # إرجاع الرابط الكامل لضمان تحميله في المتصفح
                    example_img[c] = f"http://127.0.0.1:8000/image?path={rel}"
        except Exception as e:
            # إذا كان الفهرس لا يدعم الـ reconstruction، يتخطى العملية
            continue

    # ترتيب الأماكن حسب درجة التشابه (الأكثر تكراراً في نتائج البحث)
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:k]
    
    recs = [
        {
            "place": p.replace("_", " "), 
            "score": int(cnt), 
            "image_url": example_img.get(p, "")
        } for p, cnt in ranked
    ]
    
    return {"place": place, "recommendations": recs}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    content = await file.read()
    img = Image.open(io.BytesIO(content)).convert("RGB")
    arr = np.array(img)
    x = tfm(image=arr)["image"].unsqueeze(0)

    # التنبؤ بالاسم
    logits = model(x.to(device))
    probs = torch.softmax(logits, dim=1).squeeze(0)
    topv, topi = torch.topk(probs, k=TOPK_PRED)
    preds = [{"place": class_names[i], "confidence": float(p)} for p, i in zip(topv.tolist(), topi.tolist())]

    # جلب الصور الشبيهة
    v = feat_model(x.to(device)).detach().cpu().numpy().astype("float32")
    v = v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-12)
    D, I = index.search(v, TOPK_SIM)
    
    similar = []
    for score, idx in zip(D[0].tolist(), I[0].tolist()):
        if idx < 0: continue
        m = meta_db[idx]
        rel = str(Path(m["path"]).resolve().relative_to(DATASET_DIR)).replace("\\", "/")
        similar.append({
            "place": m["class"].replace("_", " "),
            "score": float(score),
            "image_url": f"http://127.0.0.1:8000/image?path={rel}"
        })

    return {"top_predictions": preds, "similar_images": similar}

@app.get("/image")
def get_image(path: str):
    safe_path = (DATASET_DIR / path).resolve()
    if not str(safe_path).startswith(str(DATASET_DIR)) or not safe_path.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(str(safe_path))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)