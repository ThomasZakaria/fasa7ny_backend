from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import logging
from model_utils import predict_image

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Fasa7ny AI Service")

# Allow CORS for your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. LOAD THE NEW CLASSES DIRECTLY
try:
    with open('classes.json', 'r', encoding='utf-8') as f:
        class_names = json.load(f)
    logger.info(f"Successfully loaded {len(class_names)} classes.")
except Exception as e:
    logger.error(f"Failed to load classes.json: {e}")
    class_names = {}

@app.get("/health")
def health_check():
    return {"status": "healthy", "classes_loaded": len(class_names) > 0}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    # Verify file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File provided is not an image.")
    
    try:
        # Read image bytes
        image_bytes = await file.read()
        
        # 2. CALL THE UPDATED PREDICTION FUNCTION
        prediction_result = predict_image(image_bytes)
        
        logger.info(f"Prediction successful: {prediction_result}")
        return {
            "success": True,
            "prediction": prediction_result
        }
        
    except Exception as e:
        logger.error(f"Prediction error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)