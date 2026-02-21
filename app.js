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
const usersPath = path.join(__dirname, 'data', 'users.json');

function loadUsers() {
  try {
    // لو الملف مش موجود، هيكريته تلقائياً
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
// AI Detect & Save History
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    const imageUrl = req.file.path;
    const userId = req.body.userId; // هنستقبل الـ ID من الفرونت إند

    // 1. الاتصال بـ Python API
    const pythonResponse = await axios.post('http://127.0.0.1:5000/predict', {
      url: imageUrl,
    });

    const landmarkName = pythonResponse.data.class;
    const confidence = pythonResponse.data.confidence;

    // 2. جلب تفاصيل المكان من places.json
    const places = loadPlaces();
    const placeDetails = places.find((p) =>
      p['Landmark Name (English)']
        .toLowerCase()
        .includes(landmarkName.toLowerCase()),
    );

    let updatedHistory = null;

    // 3. حفظ العملية في الـ History الخاص بالمستخدم (لو كان مسجل دخول)
    if (userId) {
      const users = loadUsers(); // دالة loadUsers اللي ضفناها المرة اللي فاتت
      const userIndex = users.findIndex((u) => u.id === userId);

      if (userIndex !== -1) {
        // إنشاء كائن الـ history الجديد
        const newScan = {
          place_name: placeDetails
            ? placeDetails['Landmark Name (English)']
            : landmarkName,
          confidence: confidence,
          scannedAt: new Date().toISOString(),
        };

        // التأكد إن مصفوفة الـ scan_history موجودة وإضافة المسح الجديد
        if (!users[userIndex].scan_history) {
          users[userIndex].scan_history = [];
        }
        users[userIndex].scan_history.push(newScan);

        saveUsers(users); // حفظ في users.json
        updatedHistory = users[userIndex].scan_history;
      }
    }

    res.json({
      status: 'success',
      data: {
        prediction: landmarkName,
        confidence: confidence,
        details: placeDetails || null,
        imageUrl,
        updatedHistory, // بنرجع الـ History الجديد عشان الفرونت إند يتحدث
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// --- Update User Interests ---
app.post('/api/v1/user/update-interests', (req, res) => {
  try {
    const { userId, interests } = req.body;
    const users = loadUsers();
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1) {
      return res
        .status(404)
        .json({ status: 'fail', message: 'User not found' });
    }

    // تحديث الاهتمامات
    users[userIndex].interests = interests;
    saveUsers(users);

    res.json({
      status: 'success',
      data: { interests: users[userIndex].interests },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}); // --- Toggle Saved Place ---
app.post('/api/v1/user/toggle-save', (req, res) => {
  try {
    const { userId, place } = req.body;
    const users = loadUsers();
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1) {
      return res
        .status(404)
        .json({ status: 'fail', message: 'User not found' });
    }

    // لو مفيش array للمحفوظات، نكريتها
    if (!users[userIndex].saved_places) {
      users[userIndex].saved_places = [];
    }

    const savedList = users[userIndex].saved_places;
    const existingIndex = savedList.findIndex((p) => p.name === place.name);

    if (existingIndex !== -1) {
      // لو المكان محفوظ قبل كده -> امسحه
      savedList.splice(existingIndex, 1);
    } else {
      // لو مش محفوظ -> ضيفه
      savedList.push(place);
    }

    saveUsers(users);

    res.json({ status: 'success', data: { saved_places: savedList } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
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

// Get All Places Grouped By Category
app.get('/api/v1/categories', (req, res) => {
  try {
    const places = loadPlaces();
    const groupedCategories = {};

    places.forEach((place) => {
      const category = place.category || 'Other Places';
      if (!groupedCategories[category]) {
        groupedCategories[category] = [];
      }
      groupedCategories[category].push(place);
    });

    res.json({
      status: 'success',
      data: groupedCategories,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Near Me (Enhanced Algorithm - Always returns closest)
app.get('/api/v1/places/near-me', (req, res) => {
  try {
    // 1. هنستقبل limit بـ 5 كافتراضي، ولغينا شرط المسافة الصارم
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

    // 2. الترتيب من الأقرب للأبعد دايماً
    placesWithDistance.sort((a, b) => a.distanceAway - b.distanceAway);

    // 3. ناخد أقرب أماكن بناءً على العدد المطلوب فقط
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
// --- Auth: Sign Up ---
app.post('/api/v1/auth/signup', (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide name, email, and password.',
      });
    }

    const users = loadUsers();

    // التأكد إن الإيميل مش متسجل قبل كده
    if (users.find((u) => u.email === email)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email already exists! Please login.',
      });
    }

    // إنشاء مستخدم جديد
    const newUser = {
      id: Date.now().toString(),
      name,
      email,
      password, // في المشاريع الحقيقية بيتم تشفير الباسورد، لكن ده كافي للمشروع الحالي
      scan_history: [],
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

// --- Auth: Login ---
app.post('/api/v1/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email and password.',
      });
    }

    const users = loadUsers();
    const user = users.find(
      (u) => u.email === email && u.password === password,
    );

    if (!user) {
      return res
        .status(401)
        .json({ status: 'fail', message: 'Invalid email or password.' });
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
// 6. SERVER START
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
