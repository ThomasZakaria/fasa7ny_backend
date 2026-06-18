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

    const AI_SERVICE_URL =
      process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
    const pythonRes = await axios.post(`${AI_SERVICE_URL}/predict`, form, {
      headers: form.getHeaders(),
    });

    const predictedName = pythonRes.data.prediction || '';
    const places = loadData(placesPath);

    // البحث بحقل ai_class أولاً
    let exactMatch = places.find((p) => p.ai_class === predictedName);

    // مطابقة الاسم الإنجليزي مباشرة كخطة بديلة
    if (!exactMatch) {
      exactMatch = places.find(
        (p) =>
          p['Landmark Name (English)'] === predictedName ||
          p['Landmark Name (English)'] === predictedName.replace(/_/g, ' '),
      );
    }

    // الخريطة اليدوية للقطع الأثرية والمعالم المتداخلة
    if (!exactMatch) {
      const manualClassesMap = {
        'Karnak Temple': 'Karnak Temple Complex',
        sphinx: 'Great Sphinx of Giza',
        'Al-Azhar Mosque': 'Al-Azhar Mosque',
        'Egyptian Museum, Cairo': 'Egyptian Museum',
        'Al-Azhar_Park_(Cairo)': 'Al-Azhar Park',
        'Pompeys Pillar Alexandria': 'Pompeys Pillar Alexandria',
        'St. Catherine Monastery Mount Sinai':
          'St. Catherine Monastery Mount Sinai',
        'St. George Church in Coptic Cairo':
          'St. George Church in Coptic Cairo',
        'Hanging Church (St. Virgin Mary Coptic Orthodox Church)':
          'Hanging Church (St. Virgin Mary Coptic Orthodox Church)',
        'Mohammed Ali Mosque in cairo citadel': 'Cairo Citadel',
        'Mosque-Madrassa_of_Sultan_Hassan': 'Mosque-Madrassa_of_Sultan_Hassan',
        'Al-Deir al-Bahary Temple of Queen Hatshepsut':
          'Al-Deir al-Bahary Temple of Queen Hatshepsut',
        'Giza Pyramid Complex': 'Giza Pyramid Complex',
        'Ahmose I': 'Egyptian Museum',
        Akhenaten: 'Egyptian Museum',
        'Amenhotep III and Tiye': 'Egyptian Museum',
        'Cleopatra VII': 'Egyptian Museum',
        Djoser: 'Egyptian Museum',
        'Green Head': 'Egyptian Museum',
        'Goddess Isis with Her Child': 'Egyptian Museum',
        Horemheb: 'Egyptian Museum',
        Khafre: 'Egyptian Museum',
        'Khufu Statue': 'Egyptian Museum',
        'King Thutmose III': 'Egyptian Museum',
        'Narmer (Menes)': 'Egyptian Museum',
        'Narmer Palette': 'Egyptian Museum',
        Nefertiti: 'Egyptian Museum',
        'Queen Hatshepsut': 'Egyptian Museum',
        'Ramsis II': 'Egyptian Museum',
        'Ramsis II Red Granite Statue': 'Egyptian Museum',
        'Sesostris III': 'Egyptian Museum',
        Sobekneferu: 'Egyptian Museum',
        'Statue of Tutankhamun': 'Egyptian Museum',
        'Golden Mask of Tutankhamun': 'Egyptian Museum',
        'Golden Throne of Tutankhamun': 'Egyptian Museum',
        'Mummy of Ramsis II': 'National Museum of Egyptian Civilization',
      };

      const dbTargetName = manualClassesMap[predictedName];
      if (dbTargetName) {
        exactMatch = places.find(
          (p) => p['Landmark Name (English)'] === dbTargetName,
        );
      }
    }

    res.json({
      status: 'success',
      data: {
        prediction: exactMatch
          ? exactMatch['Landmark Name (English)']
          : predictedName,
        details: exactMatch ? exactMatch : null,
      },
    });
  } catch (err) {
    console.error('AI Detect Error:', err.message);
    res.status(500).json({ status: 'error', message: 'AI Service offline' });
  }
});

/**
 * 2. AI TRIP PLANNER (Groq Itinerary Generation)
 */
app.post('/api/v1/trip-planner', async (req, res) => {
  const { cities, days, interests, manualSelection } = req.body;
  const allPlaces = loadData(placesPath);

  // الفلترة بناءً على المدن المختارة لتقليل الـ Tokens وزيادة دقة الـ AI
  const filteredPlaces = allPlaces.filter((p) =>
    cities
      .map((c) => c.toLowerCase())
      .includes((p.Location || '').toLowerCase()),
  );

  const promptData = filteredPlaces.map((p) => ({
    name: p['Landmark Name (English)'],
    category: p.category,
    price: p.price || 'Moderate',
    isTopPick: p.isTopPick || false,
    location: p.Location,
  }));

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are an expert Egyptian tour guide.
                    1. MANUAL SELECTION: MUST include these user-selected places in the itinerary: ${JSON.stringify(manualSelection || [])}.
                    2. PRIORITIZATION: Prioritize places where 'isTopPick' is true for the rest of the itinerary.
                    3. PRICE RANGE: For every landmark, add a 'price_range' field (Budget, Moderate, Luxury).
                    4. FORMAT: Return ONLY a valid JSON object with this structure: { "itinerary": { "days": [ { "day": 1, "city": "...", "places": [ { "name": "...", "time": "...", "reason": "...", "price_range": "..." } ] } ] } }`,
        },
        {
          role: 'user',
          content: `Please generate a personalized ${days}-day trip itinerary for the following cities: ${cities.join(', ')}.
                    User interests: ${interests.join(', ')}.
                    Here is the available landmarks data to choose from: ${JSON.stringify(promptData)}`,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
    });

    const itinerary = JSON.parse(chatCompletion.choices[0].message.content);
    res.status(200).json({ status: 'success', data: itinerary });
  } catch (error) {
    console.error('Groq AI Error:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to generate trip' });
  }
});

/**
 * 3. NEAR ME (GPS Search)
 */
app.get('/api/v1/places/near-me', (req, res) => {
  const { lat, lng, distance = 100 } = req.query;

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

      if (
        p.Coordinates &&
        typeof p.Coordinates === 'string' &&
        p.Coordinates.includes(',')
      ) {
        const parts = p.Coordinates.split(',');
        pLat = parseFloat(parts[0].trim());
        pLng = parseFloat(parts[1].trim());
      }

      if (!isNaN(pLat) && !isNaN(pLng)) {
        p.distanceAway = getDistance(userLat, userLng, pLat, pLng);
      } else {
        p.distanceAway = Infinity;
      }
      return p;
    })
    .filter((p) => p.distanceAway <= maxDist)
    .sort((a, b) => a.distanceAway - b.distanceAway);

  res.json({
    status: 'success',
    results: nearby.length,
    data: { places: nearby.slice(0, 20) },
  });
});

/**
 * 4. SMART SEARCH (Fuzzy + Filters + Pagination)
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
  } else if (sort === 'relevance' || !sort) {
    // ✨ التعديل السحري: ترتيب الأماكن لضمان ظهور الـ Top Picks المشهورة في أول صفحة Explore دايماً
    places.sort((a, b) => {
      const aTop = a.isTopPick === true || a.isTopPick === 'true' ? 1 : 0;
      const bTop = b.isTopPick === true || b.isTopPick === 'true' ? 1 : 0;
      return bTop - aTop;
    });
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
 * 5. RECOMMENDATIONS (Nearest 3 + Smart Similar 3)
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
    if (currentPlace.category) {
      similar = places
        .filter(
          (p) =>
            p.category === currentPlace.category && p.ID !== currentPlace.ID,
        )
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);
    }

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
 * 6. REVIEWS & CATEGORIES
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
    grouped[cat].push(p);
  });

  // ✨ التعديل السحري: ترتيب كل قسم عشان الـ isTopPick يظهر الأول
  for (const cat in grouped) {
    grouped[cat].sort((a, b) => {
      const aTop = a.isTopPick === true || a.isTopPick === 'true' ? 1 : 0;
      const bTop = b.isTopPick === true || b.isTopPick === 'true' ? 1 : 0;
      return bTop - aTop; // التوب بيطلع فوق
    });
  }

  res.json({ status: 'success', data: grouped });
});

// ==========================================
// 7. AUTHENTICATION & USER PROFILE
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
      password, // تذكير: يفضل تشفيرها مستقبلاً بـ bcryptjs
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

app.get('/api/v1/users/:userId', (req, res) => {
  const users = loadData(usersPath);
  const user = users.find((u) => u.id === req.params.userId);
  if (!user)
    return res.status(404).json({ status: 'error', message: 'User not found' });
  const { password, ...safeData } = user;
  res.json({ status: 'success', data: { user: safeData } });
});

// ==========================================
// 8. USER ACTIONS (Save Places, Interests & Trips)
// ==========================================
app.post('/api/v1/user/save-place', (req, res) => {
  try {
    const { userId, place } = req.body;
    const users = loadData(usersPath);
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1)
      return res
        .status(404)
        .json({ status: 'error', message: 'User not found' });

    if (!users[userIndex].saved_places) users[userIndex].saved_places = [];

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

app.post('/api/v1/user/save-trip', (req, res) => {
  try {
    const { userId, itinerary, days, cities } = req.body;
    const users = loadData(usersPath);
    const userIndex = users.findIndex((u) => u.id === userId);

    if (userIndex === -1)
      return res
        .status(404)
        .json({ status: 'error', message: 'User not found' });

    if (!users[userIndex].saved_trips) users[userIndex].saved_trips = [];

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

// ==========================================
// 9. AI SMART BUDGET (Gemini Integration)
// ==========================================
app.post('/api/v1/ai/budget', async (req, res) => {
  const { placeName, location, category, description } = req.body;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key is missing from .env file');

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

    Return ONLY a valid JSON object with keys: accommodation, food, transport. No markdown formatting outside the JSON, no prose.`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      },
      { headers: { 'Content-Type': 'application/json' } },
    );

    let responseText = response.data.candidates[0].content.parts[0].text;
    responseText = responseText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    const budgetData = JSON.parse(responseText);

    res.status(200).json({ status: 'success', data: budgetData });
  } catch (error) {
    console.error('Gemini API Error:', error?.response?.data || error.message);
    res.status(200).json({
      status: 'error_fallback',
      data: { accommodation: 1500, food: 600, transport: 300 },
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Node.js Backend running on port ${PORT}`);
});
