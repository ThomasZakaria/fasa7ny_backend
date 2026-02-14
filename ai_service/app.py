from flask import Flask, request, jsonify
import torch
import torch.nn as nn
import requests
from PIL import Image
from io import BytesIO
from torchvision import transforms, models
import os

app = Flask(__name__)

# --- الإعدادات (مطابقة لـ predict.py) ---
MODEL_FILE = "best_model.pth"
CLASSES_FILE = "classes.txt"
NUM_CLASSES = 300 

# 1. تحميل قائمة الفئات
CLASS_NAMES = []
try:
    if os.path.exists(CLASSES_FILE):
        with open(CLASSES_FILE, 'r', encoding='utf-8') as f:
            CLASS_NAMES = [line.strip() for line in f.readlines() if line.strip()]
        print(f"📖 Loaded {len(CLASS_NAMES)} classes.")
except Exception as e:
    print(f"❌ Error reading classes.txt: {e}")

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# 2. بناء هيكل الموديل (EfficientNet_B3)
def get_model(num_classes):
    try:
        # محاولة تحميل الأوزان الأصلية
        model = models.efficientnet_b3(weights=models.EfficientNet_B3_Weights.IMAGENET1K_V1)
    except:
        model = models.efficientnet_b3(weights=None)
    
    # بناء الـ Classifier بالظبط كما في الـ Training
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(0.3),
        nn.Linear(in_features, num_classes)
    )
    return model

# 3. تحميل الموديل وتشغيله عالمياً
model = None
try:
    if os.path.exists(MODEL_FILE):
        model = get_model(NUM_CLASSES)
        checkpoint = torch.load(MODEL_FILE, map_location=device)
        model.load_state_dict(checkpoint)
        model = model.to(device).eval()
        print(f"✅ EfficientNet_B3 Loaded Successfully (CPU/GPU: {device})")
    else:
        print(f"❌ Error: {MODEL_FILE} not found!")
except Exception as e:
    print(f"❌ Critical Error loading model: {e}")

# 4. إعدادات معالجة الصور (يجب أن تطابق الـ 300px)
transform = transforms.Compose([
    transforms.Resize(345),         # تغيير الحجم ليكون أكبر قليلاً
    transforms.CenterCrop(300),     # قص المركز 300x300
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

@app.route('/predict', methods=['POST'])
def predict():
    if model is None: 
        return jsonify({'error': 'AI Engine not initialized'}), 500
    try:
        data = request.json
        image_url = data.get('url')
        if not image_url: return jsonify({'error': 'No URL provided'}), 400

        # تحميل الصورة ومعالجتها
        response = requests.get(image_url, timeout=10)
        img = Image.open(BytesIO(response.content)).convert('RGB')
        img_tensor = transform(img).unsqueeze(0).to(device)

        # عملية التنبؤ (Inference)
        with torch.no_grad():
            output = model(img_tensor)
            probs = torch.nn.functional.softmax(output, dim=1)
            confidence, idx = torch.max(probs, 1)
        
        class_idx = idx.item()
        score = confidence.item()
        
        # استخراج اسم المعلم السياحي
        label = CLASS_NAMES[class_idx] if class_idx < len(CLASS_NAMES) else f"Class {class_idx}"
        
        return jsonify({
            'class': label,
            'confidence': f"{score:.2%}" # النسبة المئوية
        })
    except Exception as e:
        print(f"🔥 Server Prediction Error: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # تشغيل السيرفر على بورت 5000
    app.run(port=5000, debug=False)