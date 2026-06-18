import torch
import json
from torchvision import models, transforms
import torch.nn as nn
from PIL import Image
import io

# Setup device
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 1. Load class names
with open('classes.json', 'r', encoding='utf-8') as f:
    class_names = json.load(f)

# 2. Image Transforms
data_transforms = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

# 3. FIX: Use the Correct Model Architecture (EfficientNet-B3)
model = models.efficientnet_b3(weights=None)

# EfficientNet's classifier has the Linear layer at index 1
model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(class_names))

# 4. Load the weights
model.load_state_dict(torch.load('fasa7ny_ultimate_model.pth', map_location=device))

model = model.to(device)
model.eval()
def predict_image(image_bytes):
    image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    image_tensor = data_transforms(image).unsqueeze(0).to(device)
    
    with torch.no_grad():
        outputs = model(image_tensor)
        _, preds = torch.max(outputs, 1)
        
    return class_names[int(preds.item())]