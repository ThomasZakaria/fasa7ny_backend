/**
 * Egypt Tour Guide API - JSON Database Version
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();

// ==========================================
// 1. FILE DATABASE (JSON)
// ==========================================

const placesPath = path.join(__dirname, 'data', 'places.json');
const reviewsPath = path.join(__dirname, 'data', 'reviews.json');

function loadPlaces() {
  return JSON.parse(fs.readFileSync(placesPath, 'utf-8'));
}

function loadReviews() {
  return JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
}

function saveReviews(data) {
  fs.writeFileSync(reviewsPath, JSON.stringify(data, null, 2));
}

// ==========================================
// 2. CLOUDINARY CONFIG
// ==========================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'egypt-tour-guide',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

const upload = multer({ storage });

// ==========================================
// 3. MIDDLEWARE
// ==========================================

app.use(cors());
app.use(express.json());

// ==========================================
// 4. HELPERS
// ==========================================

function detectPriceLevel(price) {
  if (!price || typeof price !== 'string') return 'unknown';
  const p = price.toLowerCase();

  if (p.includes('free')) return 'free';
  if (p.includes('budget')) return 'budget';
  if (p.includes('medium')) return 'medium';

  const numbers = p.match(/\d+/g);
  if (numbers) {
    const val = parseInt(numbers[0]);
    if (val === 0) return 'free';
    if (val <= 60) return 'budget';
    if (val <= 150) return 'medium';
    return 'fancy';
  }
  return 'unknown';
}

function priceAllowed(userChoice, placePrice) {
  if (!userChoice || userChoice === 'any') return true;

  const level = detectPriceLevel(placePrice);

  if (userChoice === 'free') return level === 'free';
  if (userChoice === 'budget') return ['free', 'budget'].includes(level);
  if (userChoice === 'medium')
    return ['free', 'budget', 'medium'].includes(level);

  return true;
}

function recommendPlaces(user, places, limit = 10) {
  const { interests = [], history = [], latest_city, budget } = user;
  const safeInterests = interests.map((i) => i.toLowerCase());
  const safeCity = latest_city?.toLowerCase() || '';

  const results = [];

  for (const place of places) {
    if (!priceAllowed(budget, place.price)) continue;

    let score = 0;
    const placeName = place['Landmark Name (English)'];
    const placeCat = place.category?.toLowerCase() || '';
    const placeLoc = place.Location?.toLowerCase() || '';

    if (safeInterests.some((i) => placeCat.includes(i))) score += 3;
    if (safeCity && placeLoc.includes(safeCity)) score += 2;
    if (history.includes(placeName)) score -= 5;
    if (place.averageRating >= 4.5) score += 2;

    results.push({
      ...place,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// distance calculation (Haversine)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ==========================================
// 5. ROUTES
// ==========================================

// AI Detect
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    const imageUrl = req.file.path;

    const pythonResponse = await axios.post('http://127.0.0.1:5000/predict', {
      url: imageUrl,
    });

    const landmarkName = pythonResponse.data.class;

    const places = loadPlaces();

    const placeDetails = places.find((p) =>
      p['Landmark Name (English)']
        .toLowerCase()
        .includes(landmarkName.toLowerCase()),
    );

    res.json({
      status: 'success',
      data: {
        prediction: landmarkName,
        confidence: pythonResponse.data.confidence,
        details: placeDetails || null,
        imageUrl,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recommendation Search
app.post('/api/v1/recommend-search', (req, res) => {
  try {
    const { userProfile, keyword } = req.body;
    let places = loadPlaces();

    if (keyword) {
      const k = keyword.toLowerCase();
      places = places.filter(
        (p) =>
          p['Landmark Name (English)']?.toLowerCase().includes(k) ||
          p['Arabic Name']?.toLowerCase().includes(k) ||
          p.category?.toLowerCase().includes(k) ||
          p.Location?.toLowerCase().includes(k),
      );
    }

    const recommendations = recommendPlaces(userProfile, places);

    res.json({
      status: 'success',
      data: { recommendations },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Near Me
app.get('/api/v1/places/near-me', (req, res) => {
  try {
    const { lat, lng, distance = 10 } = req.query;
    const places = loadPlaces();

    const nearby = places.filter((p) => {
      if (!p.location) return false;

      const [plng, plat] = p.location.coordinates;
      const d = getDistance(parseFloat(lat), parseFloat(lng), plat, plng);

      return d <= distance;
    });

    res.json({
      status: 'success',
      results: nearby.length,
      data: { places: nearby },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reviews
app.post('/api/v1/places/:placeId/reviews', (req, res) => {
  try {
    const { rating, comment, userId } = req.body;
    const reviews = loadReviews();

    const newReview = {
      id: Date.now().toString(),
      place: req.params.placeId,
      user: userId,
      rating,
      comment,
    };

    reviews.push(newReview);
    saveReviews(reviews);

    res.status(201).json({
      status: 'success',
      data: { review: newReview },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 6. SERVER START
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
