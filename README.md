# 🌍 Fasa7ny (فسحني) - AI-Powered Egypt Tour Guide

**Fasa7ny** is an intelligent, full-stack tourism platform designed to revolutionize how travelers explore Egypt's rich heritage. It bridges a robust **Node.js** backend with a high-performance **Python Computer Vision** microservice to deliver real-time landmark recognition, location-based spatial queries, and hyper-personalized hybrid recommendations.

## 🚀 Key Features

- **🧠 AI Landmark Recognition:** Instant identification of historical sites from user-uploaded images using a fine-tuned GLDv2 PyTorch model.
- **✨ Hybrid Recommendation Engine:** \* **Spatial:** Recommends the top 3 geographically closest landmarks using the Haversine formula.
  - **Visual/Architectural:** Suggests 3 similar landmarks utilizing **FAISS** vector search embeddings.
- **📍 Geo-Location Services:** "Near Me" functionality that parses user GPS coordinates to fetch and sort nearby tourist attractions within a specified radius.
- **🔍 Smart Fuzzy Search:** Forgiving search capabilities powered by `Fuse.js` to seamlessly handle typos, partial matches, and dynamic filtering (city, category).
- **💬 Integrated Review System:** Full RESTful operations allowing users to submit ratings and share their travel experiences.
- **⚡ High-Performance Architecture:** Server-side pagination, client-side lazy loading, and an in-memory upload pipeline (`multer.memoryStorage`) ensure a crash-free experience.

---

## 🏗️ System Architecture

The project is structured into three decoupled layers:

1. **Frontend (Client):** Pure HTML/CSS/Vanilla JS interface with dynamic DOM manipulation and Geolocation API integration.
2. **Backend API (Node.js):** The central hub managing routing, local JSON data bridging, geospatial math, and acting as a proxy for the AI service.
3. **AI Microservice (Python/FastAPI):** A dedicated server handling image tensor transformations, PyTorch model inferences, and FAISS similarity indexing.

---

## 🛠️ Tech Stack

**Backend (Core API)**

- **Runtime:** Node.js
- **Framework:** Express.js
- **Utilities:** `multer` (File handling), `fuse.js` (Fuzzy logic), `axios` (Microservice bridging)

**AI Microservice**

- **Framework:** FastAPI / Uvicorn
- **Machine Learning:** PyTorch, FAISS (Facebook AI Similarity Search)
- **Image Processing:** Albumentations, Pillow, NumPy
- **Data Handling:** Pandas

---

## ⚙️ Installation & Setup

To run the Fasa7ny environment locally, you need to start both the Python AI service and the Node.js backend.

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Python](https://www.python.org/) (3.9+ recommended)
- Git

### Step 1: Set Up the AI Microservice (Python)

Ensure your trained models (`best_landmarks.pt`, `faiss.index`, `faiss_meta.json`) and dataset are placed in their respective directories (`models/` and `dataset/`).

```bash
# 1. Navigate to the AI service directory
cd ai_service

# 2. Create a virtual environment
python -m venv venv

# 3. ACTIVATE the virtual environment (Crucial Step!)
# On Windows:
venv\Scripts\activate
# On Mac/Linux:
source venv/bin/activate

# 4. Install the required Python packages
pip install uvicorn fastapi python-multipart albumentations faiss-cpu pandas Pillow torch torchvision

# 5. Boot the FastAPI server (Using python -m ensures path stability)
python -m uvicorn api:app --host 127.0.0.1 --port 8000

```

_The AI service will now listen for inference requests on `http://127.0.0.1:8000`._

### Step 2: Set Up the Backend API (Node.js)

Open a **new terminal window** (do not close the Python terminal).

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Install Node.js dependencies
npm install

# 3. Ensure your 'data' folder exists with places.json, reviews.json, etc.
# 4. Start the Express server
node app.js

```

_The Backend API is now running on `http://127.0.0.1:3000`._

### Step 3: Launch the Frontend

No build step is required for the vanilla frontend. Simply serve the `web` or `frontend` directory using a local web server.
If using **VS Code**, right-click `index.html` (or `home.html`) and select **"Open with Live Server"**.

---

## 🚨 Common Troubleshooting

**Error: `'uvicorn' is not recognized as an internal or external command**`

- **Cause:** Your terminal is not utilizing the Python virtual environment.
- **Fix:** Ensure you run `venv\Scripts\activate` before starting the server. Alternatively, run `python -m uvicorn api:app` to force Python to locate the module.

**Error: `No module named uvicorn**`

- **Cause:** The virtual environment is activated, but the packages haven't been installed inside it.
- **Fix:** While `(venv)` is active in your terminal, run the `pip install ...` command listed in Step 1.

**Issue: AI Similar Recommendations not showing**

- **Cause:** Naming mismatches between `places.json` (e.g., "Cairo Tower") and `faiss_meta.json` (e.g., "Cairo_Tower").
- **Fix:** The `api.py` utilizes fuzzy string matching and string sanitization (`.replace(" ", "_")`) to automatically resolve these naming conflicts. Ensure your Python script is updated to the latest repository version.

---

## 📡 Core API Endpoints (Node.js)

| Method       | Endpoint                             | Description                                                                                 |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| **POST**     | `/api/v1/detect`                     | Proxies an image upload to the AI service and matches the prediction with database details. |
| **GET**      | `/api/v1/places/near-me`             | Takes `lat` & `lng` query params to return landmarks within a specified radius.             |
| **POST**     | `/api/v1/recommend-search`           | Advanced paginated search accepting keywords, filters, and sorting parameters.              |
| **GET**      | `/api/v1/places/:id/recommendations` | Returns the hybrid recommendation payload (Nearest + AI Similar).                           |
| **GET/POST** | `/api/v1/places/:placeId/reviews`    | Fetch or submit user reviews and ratings for a specific landmark.                           |

---

**© 2026 Fasa7ny Team. All rights reserved.**
