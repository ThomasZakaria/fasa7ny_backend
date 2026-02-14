const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const Place = require('./models/Place');

const app = express();

// ==============================
// 1. إعدادات Cloudinary و Multer ☁️
// ==============================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'egypt-tour-guide',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

const upload = multer({ storage: storage });

// ==============================
// Middleware
// ==============================
app.use(cors());
app.use(express.json());

// ==============================
// 2. Database Connection
// ==============================
mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ MongoDB Atlas Connected'))
  .catch((err) => console.error('❌ MongoDB Atlas Error:', err));

// ==============================
// Helper Functions
// ==============================
function detectPriceLevel(price) {
  if (!price || typeof price !== 'string') return 'unknown';
  const p = price.toLowerCase();
  if (p.includes('free')) return 'free';
  if (p.includes('budget')) return 'budget';
  if (p.includes('medium')) return 'medium';
  const numbers = p.match(/\d+/g);
  if (numbers && numbers.length > 0) {
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
  if (userChoice === 'budget') return level === 'free' || level === 'budget';
  if (userChoice === 'medium')
    return ['free', 'budget', 'medium'].includes(level);
  if (userChoice === 'fancy') return true;
  return true;
}

function recommendPlaces(user, places, limit = 10) {
  const { interests = [], history = [], latest_city, budget } = user;
  const safeInterests = interests.map((i) => i.toLowerCase());
  const safeCity = latest_city ? latest_city.toLowerCase() : '';
  const results = [];

  for (const place of places) {
    let score = 0;
    const placeName = place['Landmark Name (English)'];
    const placeCat = place.category ? place.category.toLowerCase() : '';
    const placeLoc = place.Location ? place.Location.toLowerCase() : '';
    const placePrice = place.price;

    if (safeInterests.some((interest) => placeCat.includes(interest)))
      score += 3;
    if (safeCity && placeLoc.includes(safeCity)) score += 2;
    if (budget === 'fancy' && detectPriceLevel(placePrice) === 'fancy')
      score += 1;
    if (placeName && history.includes(placeName)) score -= 5;
    if (!priceAllowed(budget, placePrice)) continue;

    results.push({
      _id: place._id,
      name: placeName,
      city: place.Location,
      category: place.category,
      price: placePrice,
      priceLevel: detectPriceLevel(placePrice),
      score,
      image: place.image || null,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ==============================
// 3. Controllers
// ==============================

const createPlace = async (req, res) => {
  try {
    // 👇 هذا السطر سيخبرنا بالحقيقة: هل بوستمان يرسل النوع الصحيح؟
    console.log('👉 Header Content-Type:', req.headers['content-type']);
    console.log('👉 Body (Text):', req.body);
    console.log('👉 File (Image):', req.file);

    const placeData = req.body || {}; // حماية من الـ undefined

    if (req.file) {
      placeData.image = req.file.path;
    }

    const newPlace = await Place.create(placeData);
    res.status(201).json({ status: 'success', data: { place: newPlace } });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(400).json({ status: 'fail', message: err.message });
  }
};

const getAllPlaces = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const places = await Place.find().skip(skip).limit(limit).lean();
    const total = await Place.countDocuments();
    res.status(200).json({
      status: 'success',
      results: places.length,
      pagination: { total, page, pages: Math.ceil(total / limit) },
      data: { places },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

const getPlace = async (req, res) => {
  try {
    const place = await Place.findById(req.params._id).lean();
    if (!place) return res.status(404).json({ message: 'Invalid ID' });
    res.status(200).json({ status: 'success', data: { place } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

const updatePlace = async (req, res) => {
  try {
    const place = await Place.findByIdAndUpdate(req.params._id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!place) return res.status(404).json({ message: 'Invalid ID' });
    res.status(200).json({ status: 'success', data: { place } });
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

const deletePlace = async (req, res) => {
  try {
    await Place.findByIdAndDelete(req.params._id);
    res.status(204).json({ status: 'success', data: null });
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

// ==============================
// 4. Routes
// ==============================

// ✅ Route الصور (يجب أن يكون منفصلاً)
app.post('/api/v1/places', upload.single('image'), createPlace);

// ✅ Route البحث والاقتراحات
app.get('/api/v1/places/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) return res.status(400).json({ message: 'Keyword required' });
    const regex = new RegExp(keyword, 'i');
    const places = await Place.find({
      $or: [
        { 'Landmark Name (English)': regex },
        { category: regex },
        { Location: regex },
      ],
    }).lean();
    res.json({ status: 'success', results: places.length, data: { places } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/v1/recommend-search', async (req, res) => {
  try {
    const { userProfile, keyword } = req.body;
    let query = {};
    if (keyword) {
      const regex = new RegExp(keyword, 'i');
      query = {
        $or: [
          { 'Landmark Name (English)': regex },
          { category: regex },
          { Location: regex },
        ],
      };
    }
    const places = await Place.find(query).lean();
    const recommendations = recommendPlaces(userProfile, places, 10);
    res.json({
      status: 'success',
      results: recommendations.length,
      data: { recommendations },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ✅ باقي الـ Routes (Get, Update, Delete)
app.get('/api/v1/places', getAllPlaces);
app
  .route('/api/v1/places/:_id')
  .get(getPlace)
  .patch(updatePlace)
  .delete(deletePlace);

// ==============================
// 5. Server
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ App listening on port ${PORT}`));
