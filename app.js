/**
 * Egypt Tour Guide API - Final Integrated Version
 * Features: AI Detection, Smart Search, Near-Me, Recommendations & Reviews
 */
const FormData = require('form-data');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
require('dotenv').config();

const app = express();

// ==========================================
// 1. DATABASE & FILE PATHS
// ==========================================
const dataDir = path.join(__dirname, 'data');
const placesPath = path.join(dataDir, 'places.json');
const reviewsPath = path.join(dataDir, 'reviews.json');
const usersPath = path.join(dataDir, 'users.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const loadData = (filePath) => {
  try {
    if (!fs.existsSync(filePath))
      fs.writeFileSync(filePath, JSON.stringify([]));
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err.message);
    return [];
  }
};

const saveData = (filePath, data) =>
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

// ==========================================
// 2. MIDDLEWARE & STORAGE
// ==========================================
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 3. HELPERS (خوارزميات الحساب)
// ==========================================

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

function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/_/g, ' ')
    .replace(/\(.*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================
// 4. API ROUTES
// ==========================================

/**
 * 1. AI DETECTION
 */
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ status: 'error', message: 'No image provided' });

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: 'upload.jpg',
      contentType: req.file.mimetype,
    });

    const pythonRes = await axios.post('http://127.0.0.1:8000/predict', form, {
      headers: form.getHeaders(),
    });

    const topPrediction = pythonRes.data.top_predictions[0];
    const cleanedName = cleanName(topPrediction.place || '');

    const places = loadData(placesPath);
    const fuse = new Fuse(places, {
      keys: ['Landmark Name (English)', 'Arabic Name'],
      threshold: 0.5,
    });
    const match = fuse.search(cleanedName);

    res.json({
      status: 'success',
      data: {
        prediction: cleanedName,
        details: match.length > 0 ? match[0].item : null,
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'AI Service offline' });
  }
});

/**
 * 2. NEAR ME (GPS Search)
 */
app.get('/api/v1/places/near-me', (req, res) => {
  const { lat, lng, distance = 50 } = req.query;
  if (!lat || !lng)
    return res
      .status(400)
      .json({ status: 'error', message: 'Coords required' });

  const places = loadData(placesPath);
  const nearby = places
    .map((p) => {
      let pLat, pLng;
      if (p.Coordinates)
        [pLat, pLng] = p.Coordinates.split(',').map((c) =>
          parseFloat(c.trim()),
        );
      p.distanceAway =
        pLat && pLng
          ? getDistance(parseFloat(lat), parseFloat(lng), pLat, pLng)
          : Infinity;
      return p;
    })
    .filter((p) => p.distanceAway <= parseFloat(distance))
    .sort((a, b) => a.distanceAway - b.distanceAway)
    .slice(0, 10);

  res.json({ status: 'success', data: { places: nearby } });
});

/**
 * 3. SMART SEARCH (Fuzzy + Pagination)
 */
app.post('/api/v1/recommend-search', (req, res) => {
  const {
    keyword,
    filters = {},
    sort = 'relevance',
    page = 1,
    limit = 12,
  } = req.body;
  let places = loadData(placesPath);

  if (filters.city && filters.city !== 'all') {
    places = places.filter((p) =>
      (p.Location || '').toLowerCase().includes(filters.city.toLowerCase()),
    );
  }

  if (keyword) {
    const fuse = new Fuse(places, {
      keys: ['Landmark Name (English)', 'Location', 'category'],
      threshold: 0.4,
    });
    places = fuse.search(keyword).map((r) => r.item);
  }

  if (sort === 'rating')
    places.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));

  const start = (page - 1) * limit;
  res.json({
    status: 'success',
    data: {
      recommendations: places.slice(start, start + limit),
      hasMore: start + limit < places.length,
    },
  });
});

/**
 * 4. RECOMMENDATIONS (Nearest 3 + AI Similar 3)
 */
app.get('/api/v1/places/:id/recommendations', async (req, res) => {
  try {
    const places = loadData(placesPath);
    const currentPlace = places.find(
      (p) => p.ID == req.params.id || (p._id && p._id.$oid == req.params.id),
    );

    if (!currentPlace)
      return res.status(404).json({ message: 'Place not found' });

    // --- 1. الأقرب جغرافياً ---
    let nearest = [];
    if (currentPlace.Coordinates) {
      const [lat1, lng1] = currentPlace.Coordinates.split(',').map(Number);
      nearest = places
        .filter((p) => p.ID !== currentPlace.ID && p.Coordinates)
        .map((p) => {
          const [lat2, lng2] = p.Coordinates.split(',').map(Number);
          return { ...p, distanceAway: getDistance(lat1, lng1, lat2, lng2) };
        })
        .sort((a, b) => a.distanceAway - b.distanceAway)
        .slice(0, 3);
    }

    // --- 2. الأماكن الشبيهة بالذكاء الاصطناعي ---
    let similar = [];
    try {
      const aiRes = await axios.get(
        `http://127.0.0.1:8000/recommend?place=${encodeURIComponent(currentPlace['Landmark Name (English)'])}&k=3`,
      );

      if (aiRes.data && aiRes.data.recommendations) {
        const fuse = new Fuse(places, {
          keys: ['Landmark Name (English)'],
          threshold: 0.6,
        });

        similar = aiRes.data.recommendations
          .map((rec) => {
            // ملاحظة: تم تغيير rec.class إلى rec.place ليتوافق مع مخرجات سكريبت البايثون
            const result = fuse.search(rec.place || rec.class);
            return result.length > 0 ? result[0].item : null;
          })
          .filter((item) => item !== null && item.ID !== currentPlace.ID);
      }
    } catch (aiErr) {
      console.error('AI Bridge Error:', aiErr.message);
    }

    res.json({ status: 'success', data: { nearest, similar } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 5. REVIEWS SYSTEM
 */
app.get('/api/v1/places/:placeId/reviews', (req, res) => {
  const reviews = loadData(reviewsPath);
  const filtered = reviews.filter((r) => r.placeId === req.params.placeId);
  res.json({ status: 'success', data: { reviews: filtered } });
});

app.post('/api/v1/places/:placeId/reviews', (req, res) => {
  const reviews = loadData(reviewsPath);
  const newReview = {
    id: Date.now().toString(),
    placeId: req.params.placeId,
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  reviews.push(newReview);
  saveData(reviewsPath, reviews);
  res.status(201).json({ status: 'success', data: { review: newReview } });
});

/**
 * 6. CATEGORIES (Home Page)
 */
app.get('/api/v1/categories', (req, res) => {
  const { city } = req.query;
  const places = loadData(placesPath);
  const grouped = {};

  places.forEach((p) => {
    if (
      city &&
      city !== 'all' &&
      !(p.Location || '').toLowerCase().includes(city.toLowerCase())
    )
      return;
    const cat = p.category || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    if (grouped[cat].length < 8) grouped[cat].push(p);
  });

  res.json({ status: 'success', data: grouped });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Node.js Backend running on http://127.0.0.1:${PORT}`);
});
