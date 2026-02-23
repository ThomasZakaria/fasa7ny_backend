"""
Landmark Recognition Service
Flask API wrapper for an EfficientNet_B3 Deep Learning model.
Handles image fetching, preprocessing, and inference.
"""

from flask import Flask, request, jsonify
import torch
import torch.nn as nn
import requests
from PIL import Image
from io import BytesIO
from torchvision import transforms, models
import os

app = Flask(__name__)

# --- Configuration & Global Constants ---
MODEL_FILE = "best_model.pth"
CLASSES_FILE = "classes.txt"
NUM_CLASSES = 300 

# Determine the primary compute device (use NVIDIA GPU if available)
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# 1. Load Class Labels
# Read the list of landmarks from the text file for mapping indices to names
CLASS_NAMES = []
try:
    if os.path.exists(CLASSES_FILE):
        with open(CLASSES_FILE, 'r', encoding='utf-8') as f:
            CLASS_NAMES = [line.strip() for line in f.readlines() if line.strip()]
        print(f"📖 Loaded {len(CLASS_NAMES)} classes.")
except Exception as e:
    print(f"❌ Error reading classes.txt: {e}")

# 2. Model Architecture Definition
def get_model(num_classes):
    """
    Initializes the EfficientNet_B3 architecture.
    Modifies the final classifier layer to match the specific number of landmark classes.
    """
    try:
        # Load weights from ImageNet to leverage transfer learning features
        weights = models.EfficientNet_B3_Weights.IMAGENET1K_V1
        model = models.efficientnet_b3(weights=weights)
    except Exception:
        # Fallback to empty model if internet connection/cache fails
        model = models.efficientnet_b3(weights=None)
    
    # Replace the default classifier with a custom Sequential layer
    # Dropout (0.3) is used to reduce overfitting
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(0.3),
        nn.Linear(in_features, num_classes)
    )
    return model

# 3. Model Initialization
# We load the model once at startup to ensure fast API responses
model = None
try:
    if os.path.exists(MODEL_FILE):
        model = get_model(NUM_CLASSES)
        # Load the trained weights (.pth file)
        checkpoint = torch.load(MODEL_FILE, map_location=device)
        model.load_state_dict(checkpoint)
        model = model.to(device).eval() # Set to evaluation mode (disables dropout)
        print(f"✅ EfficientNet_B3 Loaded Successfully (Running on: {device})")
    else:
        print(f"❌ Error: {MODEL_FILE} not found! Model not initialized.")
except Exception as e:
    print(f"❌ Critical Error loading model: {e}")

# 4. Image Preprocessing Pipeline
# Images must be formatted exactly as they were during training (300x300 pixels)
transform = transforms.Compose([
    transforms.Resize(345),         # Resize shortest side
    transforms.CenterCrop(300),     # Exact crop for model input
    transforms.ToTensor(),          # Convert pixels [0,255] to [0.0, 1.0]
    transforms.Normalize(           # Standard ImageNet normalization parameters
        [0.485, 0.456, 0.406], 
        [0.229, 0.224, 0.225]
    )
])

@app.route('/predict', methods=['POST'])
def predict():
    """
    Main API endpoint. Receives a JSON containing an image URL, 
    processes the image, and returns the predicted landmark name.
    """
    if model is None: 
        return jsonify({'error': 'AI Engine not initialized'}), 500
    
    try:
        # Validate input
        data = request.json
        image_url = data.get('url')
        if not image_url: 
            return jsonify({'error': 'No URL provided'}), 400

        # Fetch image from the provided URL (e.g., from Cloudinary)
        response = requests.get(image_url, timeout=10)
        img = Image.open(BytesIO(response.content)).convert('RGB')
        
        # Apply preprocessing and add batch dimension (Batch size = 1)
        img_tensor = transform(img).unsqueeze(0).to(device)

        # Inference Block
        with torch.no_grad(): # Disable gradient calculation for performance
            output = model(img_tensor)
            # Convert raw model outputs (logits) to probabilities
            probs = torch.nn.functional.softmax(output, dim=1)
            confidence, idx = torch.max(probs, 1)
        
        class_idx = idx.item()
        score = confidence.item()
        
        # Map index to human-readable landmark name
        label = CLASS_NAMES[class_idx] if class_idx < len(CLASS_NAMES) else f"Class {class_idx}"
        
        return jsonify({
            'class': label,
            'confidence': f"{score:.2%}" # Format as percentage string
        })
        
    except Exception as e:
        print(f"🔥 Server Prediction Error: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Running on internal port 5000. 
    # Note: In production, use Gunicorn or uWSGI instead of app.run()
    app.run(port=5000, debug=False)