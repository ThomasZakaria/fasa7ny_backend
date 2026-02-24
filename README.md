# 🌍 Fasa7ny (فسحني) - AI-Powered Egypt Tour Guide

**Fasa7ny** is an intelligent, full-stack tourism platform designed to revolutionize how travelers explore Egypt's rich heritage. It bridges a robust **Node.js** backend with a high-performance **Python Computer Vision** microservice to deliver real-time landmark recognition, location-based spatial queries, and hyper-personalized hybrid recommendations.

## 🚀 Key Features

- **🧠 AI Landmark Recognition:** Instant identification of historical sites from user-uploaded images using a fine-tuned GLDv2 PyTorch model.
- **✨ Hybrid Recommendation Engine:** \* **Spatial:** Recommends the top 3 geographically closest landmarks using the Haversine formula.
- **Visual/Architectural:** Suggests 3 similar landmarks utilizing **FAISS** vector search embeddings.

- **📍 Geo-Location Services:** "Near Me" functionality that parses user GPS coordinates to fetch and sort nearby tourist attractions.
- **🔍 Smart Fuzzy Search:** Forgiving search capabilities powered by `Fuse.js` to seamlessly handle typos, partial matches, and dynamic filtering (city, category, budget).
- **💬 Integrated Review System:** Full RESTful operations allowing users to submit ratings and share their travel experiences.
- **⚡ High-Performance Architecture:** Server-side pagination, client-side lazy loading, and an in-memory upload pipeline (`multer.memoryStorage`) ensure a crash-free experience even with large media datasets.

---

## 🏗️ System Architecture

The project is structured into three decoupled layers:

1. **Frontend (Client):** Pure HTML/CSS/Vanilla JS interface with dynamic DOM manipulation and Geolocation API integration.
2. **Backend API (Node.js):** The central hub managing routing, local JSON/MongoDB data bridging, geospatial math, and acting as a proxy for the AI service.
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

To run the Fasa7ny environment locally, you will need to start both the Python AI service and the Node.js backend.

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Python](https://www.python.org/) (3.9+ recommended)
- Git

### Step 1: Set Up the AI Microservice (Python)

Ensure your trained models (`best_landmarks.pt`, `faiss.index`, `faiss_meta.json`) and dataset are placed in their respective directories (`models/` and `dataset/`).

```bash
# Navigate to the AI service directory (adjust path if needed)
cd ai-service

# Create and activate a virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate

# Install the required Python packages
pip install torch torchvision fastapi uvicorn albumentations faiss-cpu pandas Pillow axios python-multipart

# Boot the FastAPI server
uvicorn api:app --host 127.0.0.1 --port 8000

```

_The AI service will now listen for inference requests on `http://127.0.0.1:8000`._

### Step 2: Set Up the Backend API (Node.js)

Open a **new terminal window**.

```bash
# Navigate to the backend directory
cd backend

# Install Node.js dependencies
npm install

# Ensure your 'data' folder exists with places.json, reviews.json, etc.
# Start the Express server
npm start
# or use 'node app.js'

```

_The Backend API is now running on `http://127.0.0.1:3000`._

### Step 3: Launch the Frontend

No build step is required for the vanilla frontend. Simply serve the `web` or `frontend` directory using a local web server.
If using **VS Code**, right-click `index.html` (or `home.html`) and select **"Open with Live Server"**.

---

## 📡 Core API Endpoints (Node.js)

| Method       | Endpoint                             | Description                                                                                 |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| **POST**     | `/api/v1/detect`                     | Proxies an image upload to the AI service and matches the prediction with database details. |
| **GET**      | `/api/v1/places/near-me`             | Takes `lat` & `lng` query params to return landmarks within a specified radius.             |
| **POST**     | `/api/v1/recommend-search`           | Advanced paginated search accepting keywords, filters, and sorting parameters.              |
| **GET**      | `/api/v1/places/:id/recommendations` | Returns the hybrid recommendation payload (Nearest + AI Similar).                           |
| **GET/POST** | `/api/v1/places/:placeId/reviews`    | Fetch or submit user reviews and ratings for a specific landmark.                           |
| **GET**      | `/api/v1/categories`                 | Retrieves categorized landmarks optimized for the Home page display limit.                  |

---

## 🧠 Algorithmic Highlights

- **FAISS Vector Search:** When a place is queried, the Python service extracts its visual feature vector using the PyTorch CNN and queries the FAISS index to find the 3 most visually/historically correlated landmarks instantly.
- **Fuzzy String Matching:** Handles bridging the gap between AI class names (e.g., `"6_october_bridge"`) and the local database formats (`"6 October Bridge"`) preventing data disjoints.
- **Haversine Formula:** Operates entirely mathematically to calculate the great-circle distance between two points on a sphere given their longitudes and latitudes.

---

**© 2026 Fasa7ny Team. All rights reserved.**
