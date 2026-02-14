const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Models
const Place = require('./models/Place');
const Review = require('./models/Review');
const User = require('./models/User');

const app = express();

// ==============================
// 1. إعدادات الصور (Cloudinary) 📸
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
// 3. Logic Helpers
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

    // Social Proof Boost
    if (place.averageRating && place.averageRating >= 4.5) score += 2;
    else if (place.averageRating && place.averageRating >= 4) score += 1;

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
      rating: place.averageRating || 0,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

async function calcAverageRatings(placeId) {
  const stats = await Review.aggregate([
    { $match: { place: new mongoose.Types.ObjectId(placeId) } }, // Fixed ID casting
    {
      $group: {
        _id: '$place',
        nRating: { $sum: 1 },
        avgRating: { $avg: '$rating' },
      },
    },
  ]);

  if (stats.length > 0) {
    await Place.findByIdAndUpdate(placeId, {
      ratingsQuantity: stats[0].nRating,
      averageRating: stats[0].avgRating.toFixed(1),
    });
  } else {
    await Place.findByIdAndUpdate(placeId, {
      ratingsQuantity: 0,
      averageRating: 0,
    });
  }
}

// ==============================
// 4. Controllers
// ==============================

// ✅ Create Place with Image
const createPlace = async (req, res) => {
  try {
    console.log('👉 File Received:', req.file);
    const placeData = req.body;
    if (req.file) placeData.image = req.file.path;

    const newPlace = await Place.create(placeData);
    res.status(201).json({ status: 'success', data: { place: newPlace } });
  } catch (err) {
    res.status(400).json({ status: 'fail', message: err.message });
  }
};

// ✅ Create User (عشان الصورة رقم 10 تشتغل)
const createUser = async (req, res) => {
  try {
    const newUser = await User.create(req.body);
    res.status(201).json({ status: 'success', data: { user: newUser } });
  } catch (err) {
    res.status(400).json({ status: 'fail', message: err.message });
  }
};

// ✅ Add Review
const createReview = async (req, res) => {
  try {
    const { userId, rating, comment } = req.body;

    // تحقق من وجود اليوزر
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // منع التكرار
    const existingReview = await Review.findOne({
      place: req.params.placeId,
      user: userId,
    });
    if (existingReview)
      return res
        .status(400)
        .json({ message: 'You already reviewed this place' });

    const review = await Review.create({
      place: req.params.placeId,
      user: userId,
      rating,
      comment,
    });

    // تحديث متوسط التقييم
    await calcAverageRatings(req.params.placeId);

    res.status(201).json({ status: 'success', data: { review } });
  } catch (err) {
    res.status(400).json({ message: err.message });
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
    res.status(500).json({ message: err.message });
  }
};

const getPlace = async (req, res) => {
  try {
    const place = await Place.findById(req.params._id).lean();
    if (!place) return res.status(404).json({ message: 'Invalid ID' });
    // هات التقييمات كمان
    const reviews = await Review.find({ place: req.params._id });
    res.status(200).json({ status: 'success', data: { place, reviews } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ==============================
// 5. Routes
// ==============================

// ✅ Users (جديد: عشان تعرف تعمل يوزر للتقييم)
app.post('/api/v1/users', createUser);

// ✅ Places & Images
app
  .route('/api/v1/places')
  .get(getAllPlaces)
  .post(upload.single('image'), createPlace); // لاحظ وجود upload.single هنا

// ✅ Reviews
app.post('/api/v1/places/:placeId/reviews', createReview);

// ✅ Search & Recommend
app.get('/api/v1/places/search', async (req, res) => {
  /* ... كود البحث القديم ... */
});
// (اختصاراً للمساحة، استخدم نفس كود البحث في ردك السابق فهو سليم)

app.post('/api/v1/recommend-search', async (req, res) => {
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
});

app
  .route('/api/v1/places/:_id')
  .get(getPlace)
  .patch(async (req, res) => {
    /* update logic */
  })
  .delete(async (req, res) => {
    /* delete logic */
  });

// ==============================
// Start Server
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ App listening on port ${PORT}`));
