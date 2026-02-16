/**
 * Egypt Tour Guide API - Main Server File
 * Core functionalities: Landmark detection, recommendation engine,
 * geospatial searching, and Cloudinary image management.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// --- Models ---
const Place = require('./models/Place');
const Review = require('./models/Review');
const User = require('./models/User');

const app = express();

// ==========================================
// 1. THIRD-PARTY SERVICES CONFIGURATION
// ==========================================

/** * Cloudinary configuration for cloud-based image hosting
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** * Multer storage engine for Cloudinary
 * Defines folder structure and allowed file extensions
 */
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'egypt-tour-guide',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

const upload = multer({ storage: storage });

// ==========================================
// 2. MIDDLEWARE & DATABASE
// ==========================================

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ MongoDB Atlas Connected'))
  .catch((err) => console.error('❌ MongoDB Atlas Error:', err));

// ==========================================
// 3. CORE BUSINESS LOGIC / HELPERS
// ==========================================

/**
 * Normalizes price strings into categorized tiers for filtering.
 * @param {string} price - The raw price string from the database.
 * @returns {string} - Tier: 'free', 'budget', 'medium', 'fancy', or 'unknown'.
 */
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

/**
 * Validates if a place's price fits within the user's budget constraints.
 * @param {string} userChoice - User's selected budget level.
 * @param {string} placePrice - Price of the location.
 * @returns {boolean}
 */
function priceAllowed(userChoice, placePrice) {
  if (!userChoice || userChoice === 'any') return true;
  const choice = userChoice.toLowerCase().trim();
  const level = detectPriceLevel(placePrice);

  if (choice === 'free') return level === 'free';
  if (choice === 'budget') return level === 'free' || level === 'budget';
  if (choice === 'medium') return ['free', 'budget', 'medium'].includes(level);
  return true; // Default for 'fancy' or undefined
}

/**
 * Scoring algorithm to rank places based on user interests, city, and history.
 * @param {Object} user - User profile data.
 * @param {Array} places - List of places to filter/score.
 * @param {number} limit - Max results to return.
 */
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

    // Scoring Logic: Interests (High Priority) > City (Medium) > Rating (Low)
    if (safeInterests.some((interest) => placeCat.includes(interest)))
      score += 3;
    if (safeCity && placeLoc.includes(safeCity)) score += 2;
    if (placeName && history.includes(placeName)) score -= 5; // Penalty for visited places
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

// ==========================================
// 4. API ROUTES
// ==========================================

/**
 * @route POST /api/v1/detect
 * @desc  Uploads an image to Cloudinary and sends URL to Python AI for recognition.
 */
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: 'No image uploaded' });

    const imageUrl = req.file.path;

    // Call external AI service (Python/FastAPI/Flask)
    const pythonResponse = await axios.post('http://127.0.0.1:5000/predict', {
      url: imageUrl,
    });

    const landmarkName = pythonResponse.data.class;

    // Fetch rich data from MongoDB based on AI prediction
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
      .json({ message: 'Error connecting to AI model', error: err.message });
  }
});

/**
 * @route POST /api/v1/recommend-search
 * @desc  Hybrid search: combines keyword filtering with personalized scoring.
 */
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

/**
 * @route GET /api/v1/places/near-me
 * @desc  Finds landmarks within a specific radius using MongoDB $near.
 */
app.get('/api/v1/places/near-me', async (req, res) => {
  try {
    const { lat, lng, distance } = req.query;
    if (!lat || !lng)
      return res.status(400).json({ message: 'Missing coordinates' });

    const radius = distance || 10; // Default 10km
    const places = await Place.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: radius * 1000, // Convert km to meters
        },
      },
    });
    res.json({ status: 'success', results: places.length, data: { places } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route POST /api/v1/places/:placeId/reviews
 * @desc  Submit review and automatically recalculate Place average ratings.
 */
app.post('/api/v1/places/:placeId/reviews', async (req, res) => {
  try {
    const { userId, rating, comment } = req.body;
    const review = await Review.create({
      place: req.params.placeId,
      user: userId,
      rating,
      comment,
    });

    // Recalculate Average via MongoDB Aggregation Pipeline
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

    if (stats.length > 0) {
      await Place.findByIdAndUpdate(req.params.placeId, {
        ratingsQuantity: stats[0].nRating,
        averageRating: stats[0].avgRating.toFixed(1),
      });
    }

    res.status(201).json({ status: 'success', data: { review } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ==========================================
// 5. SERVER INITIALIZATION
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server active on port ${PORT}`);
});
