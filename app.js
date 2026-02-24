/**
 * Egypt Tour Guide API - Final Integrated Version
 * Features: AI Detection, Smart Search, Near-Me, Recommendations, Reviews & Full Auth
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
 * 1. AI DETECTION (Landmark Image Scan)
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
 * 2. NEAR ME (GPS Search) - Optimized & Bug Fixed
 */
app.get('/api/v1/places/near-me', (req, res) => {
  const { lat, lng, distance = 100 } = req.query; // رفعنا المسافة الافتراضية لـ 100 كم

  if (!lat || !lng) {
    return res
      .status(400)
      .json({ status: 'error', message: 'User coordinates are required' });
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const maxDist = parseFloat(distance);

  const places = loadData(placesPath);

  const nearby = places
    .map((p) => {
      let pLat = NaN,
        pLng = NaN;

      // تحسين قراءة الإحداثيات وتنظيف النص
      if (
        p.Coordinates &&
        typeof p.Coordinates === 'string' &&
        p.Coordinates.includes(',')
      ) {
        const parts = p.Coordinates.split(',');
        pLat = parseFloat(parts[0].trim());
        pLng = parseFloat(parts[1].trim());
      }

      // التحقق من أن الأرقام صالحة (ليست NaN)
      if (!isNaN(pLat) && !isNaN(pLng)) {
        p.distanceAway = getDistance(userLat, userLng, pLat, pLng);
      } else {
        p.distanceAway = Infinity;
      }
      return p;
    })
    // فلترة الأماكن التي تقع ضمن النطاق فقط
    .filter((p) => p.distanceAway <= maxDist)
    // الترتيب من الأقرب للأبعد
    .sort((a, b) => a.distanceAway - b.distanceAway);

  res.json({
    status: 'success',
    results: nearby.length,
    data: { places: nearby.slice(0, 20) },
  });
});
/**
 * 3. SMART SEARCH (Fuzzy + Filters + Pagination)
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

  if (filters.category && filters.category !== 'all') {
    places = places.filter((p) =>
      (p.category || '').toLowerCase().includes(filters.category.toLowerCase()),
    );
  }

  if (filters.budget && filters.budget !== 'any') {
    places = places.filter((p) =>
      (p.price || '').toLowerCase().includes(filters.budget.toLowerCase()),
    );
  }

  if (keyword) {
    const fuse = new Fuse(places, {
      keys: ['Landmark Name (English)', 'Arabic Name', 'Location', 'category'],
      threshold: 0.4,
    });
    places = fuse.search(keyword).map((r) => r.item);
  }

  if (sort === 'rating') {
    places.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
  } else if (sort === 'budget-asc') {
    const weights = { free: 0, budget: 1, moderate: 2, expensive: 3 };
    places.sort(
      (a, b) =>
        (weights[(a.price || '').toLowerCase()] || 99) -
        (weights[(b.price || '').toLowerCase()] || 99),
    );
  }

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
 * 5. REVIEWS & CATEGORIES
 */
app.get('/api/v1/places/:placeId/reviews', (req, res) => {
  const reviews = loadData(reviewsPath);
  res.json({
    status: 'success',
    data: { reviews: reviews.filter((r) => r.placeId === req.params.placeId) },
  });
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
    grouped[cat].push(p); // إرسال الكل لدعم صفحة Explore
  });
  res.json({ status: 'success', data: grouped });
});

// ==========================================
// 6. AUTHENTICATION & USER PROFILE
// ==========================================

app.post('/api/v1/signup', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res
        .status(400)
        .json({ status: 'error', message: 'All fields required' });

    const users = loadData(usersPath);
    if (users.find((u) => u.email === email))
      return res.status(400).json({ status: 'error', message: 'Email exists' });

    const newUser = {
      id: Date.now().toString(),
      username,
      email,
      password,
      interests: [],
      scan_history: [],
      saved_places: [],
    };
    users.push(newUser);
    saveData(usersPath, users);
    res.status(201).json({
      status: 'success',
      data: {
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/v1/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadData(usersPath);
    const user = users.find(
      (u) => u.email === email && u.password === password,
    );
    if (!user)
      return res
        .status(401)
        .json({ status: 'error', message: 'Invalid credentials' });
    res.json({
      status: 'success',
      data: {
        user: { id: user.id, username: user.username, email: user.email },
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// جديد: جلب بيانات البروفايل كاملة
app.get('/api/v1/users/:userId', (req, res) => {
  const users = loadData(usersPath);
  const user = users.find((u) => u.id === req.params.userId);
  if (!user)
    return res.status(404).json({ status: 'error', message: 'User not found' });
  const { password, ...safeData } = user;
  res.json({ status: 'success', data: { user: safeData } });
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`🚀 Node.js Backend running on http://127.0.0.1:${PORT}`),
);
// ==========================================
// 7. USER ACTIONS (Save Places & Interests)
// ==========================================

// مسار حفظ الأماكن في ملف المستخدم
app.post('/api/v1/user/save-place', (req, res) => {
  try {
    const { userId, place } = req.body;
    const users = loadData(usersPath);
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1) {
      return res
        .status(404)
        .json({ status: 'error', message: 'User not found' });
    }

    // التأكد من وجود مصفوفة الأماكن المحفوظة
    if (!users[userIndex].saved_places) {
      users[userIndex].saved_places = [];
    }

    // منع تكرار حفظ نفس المكان
    const alreadySaved = users[userIndex].saved_places.some(
      (p) => p.id === place.id,
    );

    if (!alreadySaved) {
      users[userIndex].saved_places.push(place);
      saveData(usersPath, users);
      return res.json({
        status: 'success',
        message: 'Place saved successfully',
      });
    } else {
      return res.json({ status: 'info', message: 'Place already saved' });
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// مسار تحديث اهتمامات المستخدم
app.post('/api/v1/user/update-interests', (req, res) => {
  try {
    const { userId, interests } = req.body;
    const users = loadData(usersPath);
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex !== -1) {
      users[userIndex].interests = interests;
      saveData(usersPath, users);
      return res.json({ status: 'success', message: 'Interests updated' });
    }
    res.status(404).json({ status: 'error', message: 'User not found' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
