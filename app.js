const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios'); // مكتبة الربط مع Flask
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Models
const Place = require('./models/Place');
const Review = require('./models/Review');
const User = require('./models/User');

const app = express();

// ==============================
// 1. إعدادات Cloudinary 📸
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
// 3. Helper Functions
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
  const choice = userChoice.toLowerCase().trim();
  const level = detectPriceLevel(placePrice);
  if (choice === 'free') return level === 'free';
  if (choice === 'budget') return level === 'free' || level === 'budget';
  if (choice === 'medium') return ['free', 'budget', 'medium'].includes(level);
  if (choice === 'fancy') return true;
  return true;
}

function recommendPlaces(user, places, limit = 10) {
  const { interests = [], history = [], latest_city, budget } = user;
  const safeInterests = interests.map((i) => i.toLowerCase());
  const safeCity = latest_city ? latest_city.toLowerCase() : '';
  const results = [];

  for (const place of places) {
    if (!priceAllowed(budget, place.price)) continue;

    let score = 0;
    const placeName = place['Landmark Name (English)'];
    const placeCat = place.category ? place.category.toLowerCase() : '';
    const placeLoc = place.Location ? place.Location.toLowerCase() : '';

    if (safeInterests.some((interest) => placeCat.includes(interest)))
      score += 3;
    if (safeCity && placeLoc.includes(safeCity)) score += 2;
    if (placeName && history.includes(placeName)) score -= 5;
    if (place.averageRating && place.averageRating >= 4.5) score += 2;

    results.push({
      _id: place._id,
      name: placeName,
      city: place.Location,
      category: place.category,
      price: place.price,
      score,
      image: place.image || null,
      rating: place.averageRating || 0,
      location: place.location,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ==============================
// 4. Controllers & Routes
// ==============================

// app.js (تعديل الـ detect route)
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'يرجى رفع صورة' });

    const imageUrl = req.file.path;

    // 1. التعرف على الأثر من سيرفر البايثون
    const pythonResponse = await axios.post('http://127.0.0.1:5000/predict', {
      url: imageUrl,
    });

    const landmarkName = pythonResponse.data.class;

    // 2. البحث عن تفاصيل هذا المكان في الداتابيز لدينا
    const placeDetails = await Place.findOne({
      'Landmark Name (English)': new RegExp(landmarkName, 'i'),
    }).lean();

    res.json({
      status: 'success',
      data: {
        prediction: landmarkName,
        confidence: pythonResponse.data.confidence,
        details:
          placeDetails ||
          'Landmark recognized but no details found in database',
        imageUrl: imageUrl,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: 'خطأ في الربط مع الموديل', error: err.message });
  }
});

// البحث والترشيح الهجين
app.post('/api/v1/recommend-search', async (req, res) => {
  try {
    const { userProfile, keyword } = req.body;
    let query = {};
    if (keyword) {
      const regex = new RegExp(keyword, 'i');
      query = {
        $or: [
          { 'Landmark Name (English)': regex },
          { 'Arabic Name': regex },
          { category: regex },
          { Location: regex },
        ],
      };
    }
    const places = await Place.find(query).lean();
    const recommendations = recommendPlaces(userProfile, places);
    res.json({ status: 'success', data: { recommendations } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// الأماكن القريبة
app.get('/api/v1/places/near-me', async (req, res) => {
  try {
    const { lat, lng, distance } = req.query;
    if (!lat || !lng)
      return res.status(400).json({ message: 'Missing coordinates' });
    const radius = distance || 10;
    const places = await Place.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: radius * 1000,
        },
      },
    });
    res.json({ status: 'success', results: places.length, data: { places } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD الأماكن
app
  .route('/api/v1/places')
  .get(async (req, res) => {
    const places = await Place.find().lean();
    res.json({ status: 'success', results: places.length, data: { places } });
  })
  .post(upload.single('image'), async (req, res) => {
    try {
      const data = req.body;
      if (req.file) data.image = req.file.path;
      const newPlace = await Place.create(data);
      res.status(201).json({ status: 'success', data: { place: newPlace } });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });

// التقييمات
app.post('/api/v1/places/:placeId/reviews', async (req, res) => {
  try {
    const { userId, rating, comment } = req.body;
    const review = await Review.create({
      place: req.params.placeId,
      user: userId,
      rating,
      comment,
    });

    // تحديث المتوسط (دالة calcAverageRatings المفروض تكون موجودة كـ Helper)
    const stats = await Review.aggregate([
      { $match: { place: new mongoose.Types.ObjectId(req.params.placeId) } },
      {
        $group: {
          _id: '$place',
          nRating: { $sum: 1 },
          avgRating: { $avg: '$rating' },
        },
      },
    ]);
    await Place.findByIdAndUpdate(req.params.placeId, {
      ratingsQuantity: stats[0].nRating,
      averageRating: stats[0].avgRating.toFixed(1),
    });

    res.status(201).json({ status: 'success', data: { review } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// رابط إصلاح البيانات القديمة
app.get('/api/v1/fix-data', async (req, res) => {
  const places = await Place.find();
  let count = 0;
  for (const place of places) {
    if (
      place.Coordinates &&
      (!place.location || !place.location.coordinates.length)
    ) {
      const parts = place.Coordinates.replace(/\s/g, '').split(',');
      if (parts.length === 2) {
        place.location = {
          type: 'Point',
          coordinates: [parseFloat(parts[1]), parseFloat(parts[0])],
        };
        await place.save();
        count++;
      }
    }
  }
  res.json({ message: `تم إصلاح ${count} مكان` });
});

// ==============================
// 5. Server
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
