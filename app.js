/**
 * Egypt Tour Guide API - JSON Database Version
 * Integrated with Smart Search (Fuse.js), Recommendations, and AI.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js'); // Smart Search Library
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
const cors = require('cors');
app.use(
  cors({
    origin: 'https://fasa7ny-frontend.vercel.app', // Change this to your actual frontend link
  }),
);
// ==========================================
// 1. FILE DATABASE (JSON)
// ==========================================

const placesPath = path.join(__dirname, 'data', 'places.json');
const reviewsPath = path.join(__dirname, 'data', 'reviews.json');
const usersPath = path.join(__dirname, 'data', 'users.json');

function loadPlaces() {
  return JSON.parse(fs.readFileSync(placesPath, 'utf-8'));
}

function loadReviews() {
  if (!fs.existsSync(reviewsPath))
    fs.writeFileSync(reviewsPath, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
}

function saveReviews(data) {
  fs.writeFileSync(reviewsPath, JSON.stringify(data, null, 2));
}

function loadUsers() {
  try {
    if (!fs.existsSync(usersPath)) {
      fs.writeFileSync(usersPath, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function saveUsers(data) {
  fs.writeFileSync(usersPath, JSON.stringify(data, null, 2));
}

// ==========================================
// 2. CLOUDINARY CONFIG (Image Uploads)
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
// 4. HELPERS (Algorithms & Logic)
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
    if (history.includes(placeName)) score -= 5; // Demote visited places
    if (place.averageRating >= 4.5) score += 2;

    results.push({ ...place, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Distance calculation (Haversine Formula)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
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
// 5. AUTHENTICATION ROUTES
// ==========================================

// Sign Up
app.post('/api/v1/auth/signup', (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ status: 'fail', message: 'Missing fields.' });
    }

    const users = loadUsers();
    if (users.find((u) => u.email === email)) {
      return res
        .status(400)
        .json({ status: 'fail', message: 'Email already exists.' });
    }

    const newUser = {
      id: Date.now().toString(),
      name,
      email,
      password,
      scan_history: [],
      saved_places: [],
      interests: [],
    };

    users.push(newUser);
    saveUsers(users);

    res.status(201).json({
      status: 'success',
      data: {
        user: { id: newUser.id, name: newUser.name, email: newUser.email },
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Login
app.post('/api/v1/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadUsers();
    const user = users.find(
      (u) => u.email === email && u.password === password,
    );

    if (!user) {
      return res
        .status(401)
        .json({ status: 'fail', message: 'Invalid credentials.' });
    }

    res.status(200).json({
      status: 'success',
      data: { user: { id: user.id, name: user.name, email: user.email } },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 6. USER PROFILE ROUTES
// ==========================================

// Update Interests
app.post('/api/v1/user/update-interests', (req, res) => {
  try {
    const { userId, interests } = req.body;
    const users = loadUsers();
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1)
      return res
        .status(404)
        .json({ status: 'fail', message: 'User not found' });

    users[userIndex].interests = interests;
    saveUsers(users);

    res.json({
      status: 'success',
      data: { interests: users[userIndex].interests },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Toggle Save Place
app.post('/api/v1/user/toggle-save', (req, res) => {
  try {
    const { userId, place } = req.body;
    const users = loadUsers();
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1)
      return res
        .status(404)
        .json({ status: 'fail', message: 'User not found' });

    if (!users[userIndex].saved_places) users[userIndex].saved_places = [];
    const savedList = users[userIndex].saved_places;
    const existingIndex = savedList.findIndex((p) => p.name === place.name);

    if (existingIndex !== -1) {
      savedList.splice(existingIndex, 1); // Remove if exists
    } else {
      savedList.push(place); // Add if not exists
    }

    saveUsers(users);
    res.json({ status: 'success', data: { saved_places: savedList } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 7. PLACES & SMART SEARCH ROUTES
// ==========================================

// AI Detect Image
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    const imageUrl = req.file.path;
    const userId = req.body.userId;

    const pythonResponse = await axios.post('http://127.0.0.1:5000/predict', {
      url: imageUrl,
    });
    const landmarkName = pythonResponse.data.class;
    const confidence = pythonResponse.data.confidence;

    const places = loadPlaces();
    const placeDetails = places.find((p) =>
      p['Landmark Name (English)']
        .toLowerCase()
        .includes(landmarkName.toLowerCase()),
    );

    let updatedHistory = null;
    if (userId) {
      const users = loadUsers();
      const userIndex = users.findIndex((u) => u.id === userId);

      if (userIndex !== -1) {
        if (!users[userIndex].scan_history) users[userIndex].scan_history = [];
        users[userIndex].scan_history.push({
          place_name: placeDetails
            ? placeDetails['Landmark Name (English)']
            : landmarkName,
          confidence,
          scannedAt: new Date().toISOString(),
        });
        saveUsers(users);
        updatedHistory = users[userIndex].scan_history;
      }
    }

    res.json({
      status: 'success',
      data: {
        prediction: landmarkName,
        confidence,
        details: placeDetails || null,
        imageUrl,
        updatedHistory,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Categories (With Safe City Filter)
app.get('/api/v1/categories', (req, res) => {
  try {
    const { city } = req.query;
    let places = loadPlaces();

    if (city && city.toLowerCase() !== 'all') {
      places = places.filter((place) => {
        if (!place.Location) return false;
        return place.Location.toLowerCase().includes(city.toLowerCase());
      });
    }

    const groupedCategories = {};
    places.forEach((place) => {
      const category = place.category || 'Other Places';
      if (!groupedCategories[category]) groupedCategories[category] = [];
      groupedCategories[category].push(place);
    });

    res.json({ status: 'success', data: groupedCategories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Near Me Algorithm
app.get('/api/v1/places/near-me', (req, res) => {
  try {
    const { lat, lng, limit = 5 } = req.query;
    const places = loadPlaces();
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (isNaN(userLat) || isNaN(userLng)) {
      return res
        .status(400)
        .json({ status: 'fail', message: 'Invalid coordinates provided.' });
    }

    const placesWithDistance = places
      .map((p) => {
        let pLat, pLng;
        if (p['Coordinates']) {
          const coords = p['Coordinates'].split(',');
          pLat = parseFloat(coords[0].trim());
          pLng = parseFloat(coords[1].trim());
        } else if (p.location && p.location.coordinates) {
          pLng = parseFloat(p.location.coordinates[0]);
          pLat = parseFloat(p.location.coordinates[1]);
        } else {
          return null;
        }

        if (isNaN(pLat) || isNaN(pLng)) return null;

        const distanceAway = getDistance(userLat, userLng, pLat, pLng);
        return { ...p, distanceAway };
      })
      .filter((p) => p !== null);

    placesWithDistance.sort((a, b) => a.distanceAway - b.distanceAway);
    const finalResults = placesWithDistance.slice(0, parseInt(limit));

    res.json({
      status: 'success',
      results: finalResults.length,
      data: { places: finalResults },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Smart Search (Fuzzy Matching + Filters + Interests Scoring)
// ==========================================
// Smart Search (Fuzzy Matching + Filters + Interests Scoring)
// ==========================================
app.post('/api/v1/recommend-search', (req, res) => {
  try {
    const { userProfile, keyword, filters } = req.body;
    let places = loadPlaces();

    // 1. Fuzzy Search with Fuse.js (With Smart Weights)
    if (keyword && keyword.trim() !== '') {
      const fuseOptions = {
        // إعطاء أهمية (وزن) أكبر لاسم المكان عن باقي البيانات
        keys: [
          { name: 'Landmark Name (English)', weight: 0.6 },
          { name: 'Arabic Name', weight: 0.2 },
          { name: 'category', weight: 0.1 },
          { name: 'Location', weight: 0.1 },
        ],
        threshold: 0.4, // رفع النسبة لـ 0.4 عشان يتسامح مع الأخطاء الإملائية الأكبر
        distance: 100,
        ignoreLocation: true,
      };
      const fuse = new Fuse(places, fuseOptions);
      const result = fuse.search(keyword);
      places = result.map((res) => res.item);
    }

    // 2. Apply UI Filters (Smart Category Matching)
    if (filters) {
      if (filters.city && filters.city !== 'all') {
        places = places.filter(
          (p) =>
            p.Location &&
            p.Location.toLowerCase().includes(filters.city.toLowerCase()),
        );
      }

      if (filters.category && filters.category !== 'all') {
        const filterCat = filters.category.toLowerCase();
        places = places.filter((p) => {
          if (!p.category) return false;
          const dbCat = p.category.toLowerCase();

          // حل مشكلة عدم التطابق بين الواجهة والداتا بيز
          return (
            dbCat.includes(filterCat) ||
            filterCat.includes(dbCat) ||
            (filterCat.includes('temple') && dbCat.includes('temple')) ||
            (filterCat.includes('mosque') && dbCat.includes('islamic')) ||
            (filterCat.includes('church') && dbCat.includes('coptic'))
          );
        });
      }

      if (filters.budget && filters.budget !== 'any') {
        places = places.filter((p) => priceAllowed(filters.budget, p.price));
      }
    }

    // 3. Score & Recommend (Limit increased to 50 so no valid search results are hidden)
    const recommendations = recommendPlaces(userProfile || {}, places, 50);

    res.json({
      status: 'success',
      results: recommendations.length,
      data: { recommendations },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================================
// 8. REVIEWS ROUTES
// ==========================================

app.get('/api/v1/places/:placeId/reviews', (req, res) => {
  try {
    const reviews = loadReviews();
    const placeReviews = reviews.filter((r) => r.place === req.params.placeId);
    res.status(200).json({
      status: 'success',
      results: placeReviews.length,
      data: { reviews: placeReviews },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/v1/places/:placeId/reviews', (req, res) => {
  try {
    const { rating, comment, userId, username } = req.body;
    const reviews = loadReviews();

    const newReview = {
      id: Date.now().toString(),
      place: req.params.placeId,
      user: userId,
      username: username || 'Anonymous',
      rating: Number(rating),
      comment,
      createdAt: new Date().toISOString(),
    };

    reviews.push(newReview);
    saveReviews(reviews);

    res.status(201).json({ status: 'success', data: { review: newReview } });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 9. SERVER START
// ==========================================

// const PORT = process.env.PORT || 3000;

// app.listen(PORT, () => {
//   console.log(`🚀 Fasa7ny AI Server is running on port ${PORT}`);
// });
module.exports = app;
