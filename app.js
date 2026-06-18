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
const Groq = require('groq-sdk');
const app = express();
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});
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

    // --- التعديل هنا ---
    // الـ API الجديد بيرجع النتيجة مباشرة في pythonRes.data.prediction
    const predictedName = pythonRes.data.prediction || '';
    const cleanedName = cleanName(predictedName);
    // ------------------

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
    console.error('AI Detect Error:', err.message); // ضفتلك السطر ده عشان لو حصل مشكلة تظهر في الكونسول
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
 * 4. RECOMMENDATIONS (Nearest 3 + Smart Similar 3)
 */
app.get('/api/v1/places/:id/recommendations', async (req, res) => {
  try {
    const places = loadData(placesPath);
    const currentPlace = places.find(
      (p) => p.ID == req.params.id || (p._id && p._id.$oid == req.params.id),
    );

    if (!currentPlace)
      return res.status(404).json({ message: 'Place not found' });

    // 1. الأقرب جغرافياً (Nearest) - زي ما هي شغالة تمام
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

    // 2. الأماكن المشابهة الذكية (Smart Similar) - التعديل الجديد
    let similar = [];

    if (currentPlace.category) {
      // بنفلتر الأماكن عشان نجيب اللي من نفس التصنيف (مثلاً معابد زي معبد حتشبسوت)
      similar = places
        .filter(
          (p) =>
            p.category === currentPlace.category && p.ID !== currentPlace.ID,
        )
        // بنعمل ترتيب عشوائي عشان يعرض أماكن مختلفة كل مرة
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);
    }

    // لو مفيش أماكن من نفس التصنيف، بنجيب أعلى 3 أماكن في التقييم العام
    if (similar.length === 0) {
      similar = places
        .filter((p) => p.ID !== currentPlace.ID)
        .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
        .slice(0, 3);
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
// ==========================================
// 7. USER ACTIONS (Save Places, Interests & Trips)
// ==========================================

// 1. مسار حفظ الأماكن في ملف المستخدم
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

    if (!users[userIndex].saved_places) {
      users[userIndex].saved_places = [];
    }

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

// 2. مسار تحديث اهتمامات المستخدم
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

// 3. مسار حفظ الرحلات (AI Trips) للمستخدم (الجديد)
app.post('/api/v1/user/save-trip', (req, res) => {
  try {
    const { userId, itinerary, days, cities } = req.body;
    const users = loadData(usersPath);
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1) {
      return res
        .status(404)
        .json({ status: 'error', message: 'User not found' });
    }

    if (!users[userIndex].saved_trips) {
      users[userIndex].saved_trips = [];
    }

    const newTrip = {
      tripId: 'trip_' + Date.now(),
      cities: cities,
      days: days,
      createdAt: new Date().toISOString(),
      itinerary: itinerary,
      progress: 0,
    };

    users[userIndex].saved_trips.push(newTrip);
    saveData(usersPath, users);

    res.json({
      status: 'success',
      message: 'Trip saved successfully',
      data: newTrip,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
app.post('/api/v1/trip-planner', async (req, res) => {
  try {
    const { cities, days, interests } = req.body;

    if (!cities || !cities.length || !days) {
      return res
        .status(400)
        .json({ status: 'error', message: 'Please select cities and days' });
    }

    const allPlaces = loadData(placesPath);
    const filteredPlaces = allPlaces.filter((place) => {
      const placeLocation = (place.Location || '').toLowerCase();
      return cities.some((city) => placeLocation.includes(city.toLowerCase()));
    });

    if (filteredPlaces.length === 0) {
      return res
        .status(404)
        .json({ status: 'error', message: 'No attractions found.' });
    }

    // هنا ضفنا السعر (price) للبيانات اللي بنبعتها للـ AI
    const dynamicAttractionsList = filteredPlaces
      .map((p) => {
        return `- Name: "${p['Landmark Name (English)']}" | Category: "${p.category || 'General'}" | Price: "${p.price || 'Free'}"`;
      })
      .join('\n');

    const interestText =
      interests && interests.length > 0
        ? `The user ONLY wants to visit places related to these categories: [${interests.join(', ')}]. You MUST prioritize places from these categories.`
        : `Choose the most famous and highly-rated places.`;

    // طلبنا السعر صراحة في الـ Prompt الجديد
    const prompt = `
You are a premium AI travel planner for the Fasa7ny app.
Create an incredible, highly detailed ${days}-day itinerary for ${cities.join(', ')}.

${interestText}

STRICT INSTRUCTIONS:
1. Use ONLY attractions listed under "ALLOWED PLACES". Do NOT invent places.
2. Distribute places logically (2-3 per day).
3. For each place, provide a short, exciting "reason" to visit (1-2 sentences).
4. Assign a logical time of day (Morning, Afternoon, Evening).
5. Extract the exact "Price" from the ALLOWED PLACES list.
6. You MUST return a JSON OBJECT for each place with keys: "name", "category", "time", "price", and "reason".

ALLOWED PLACES:
${dynamicAttractionsList}

EXPECTED JSON FORMAT:
{
  "days": [
    {
      "day": 1,
      "city": "City Name",
      "places": [
        {
          "name": "Exact Landmark Name",
          "category": "Category",
          "time": "Morning",
          "price": "Budget",
          "reason": "Start your day exploring this incredible ancient wonder..."
        }
      ]
    }
  ]
}
`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const structuredItinerary = JSON.parse(
      completion.choices[0]?.message?.content || '{}',
    );

    res.json({ status: 'success', data: { itinerary: structuredItinerary } });
  } catch (err) {
    console.error('Trip Planner Error:', err);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to generate itinerary' });
  }
});
// ==========================================
// 8. AI SMART BUDGET (Gemini Integration)
// ==========================================
app.post('/api/v1/ai/budget', async (req, res) => {
  // بنستقبل تفاصيل أكتر من الفرونت إند دلوقتي
  const { placeName, location, category, description } = req.body;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key is missing from .env file');
    }

    // الـ Prompt الاحترافي مدمج مع تفاصيل المكان
    const prompt = `Act as an expert Egyptian tour guide. Provide highly accurate, realistic daily costs in EGP (Egyptian Pounds) specifically for the year 2026 for a tourist visiting the following location:
    - Landmark Name: ${placeName || 'Egypt (General average)'}
    - City/Region: ${location || 'Egypt'}
    - Category: ${category || 'Tourist Attraction'}
    - Context/Details: ${description || 'A popular destination in Egypt'}

    Take into account the 2026 economic context in Egypt (recent fuel price increases, updated Uber/taxi tariffs, and current hospitality rates). 

    Rules:
    1. Accommodation: Average cost for a standard 3-star hotel room per night in the specified City/Region (typically ranges between 1,200 EGP to 2,500 EGP).
    2. Food: Average daily cost for 3 standard tourist-friendly meals near this specific landmark (mix of local sit-down spots and casual tourist dining, typically 600 EGP to 1,200 EGP).
    3. Transport: Average daily cost for 2–3 local Uber or registered taxi rides within that specific area (typically 300 EGP to 600 EGP).

    Do not use outdated pre-inflation rates. Provide a single, realistic average integer for each category based on the requested location context.

    Return ONLY a valid JSON object with keys: accommodation, food, transport. No markdown formatting outside the JSON, no prose.
    Example: {"accommodation": 1800, "food": 800, "transport": 450}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0, // لضمان دقة وثبات الأرقام في كل مرة
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    let responseText = response.data.candidates[0].content.parts[0].text;

    responseText = responseText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    const budgetData = JSON.parse(responseText);

    res.status(200).json({
      status: 'success',
      data: budgetData,
    });
  } catch (error) {
    console.error('Gemini API Error:', error?.response?.data || error.message);

    res.status(200).json({
      status: 'error_fallback',
      data: { accommodation: 1500, food: 600, transport: 300 },
    });
  }
});
const PORT = 3000;
app.listen(PORT, () =>
  console.log(`🚀 Node.js Backend running on http://127.0.0.1:${PORT}`),
);
