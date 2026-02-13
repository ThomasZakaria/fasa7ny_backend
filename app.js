const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // Make sure to run: npm install cors
require('dotenv').config();

const Place = require('./models/Place');

const app = express();

// ==============================
// Middleware
// ==============================
app.use(express.json());
app.use(cors()); // Enables connection from React/Frontend

// ==============================
// 1. Database Connection
// ==============================
mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ MongoDB Atlas Connected'))
  .catch((err) => console.error('❌ MongoDB Atlas Error:', err));

// ==============================
// 2. Helper Functions (Smart Logic)
// ==============================

function detectPriceLevel(price) {
  if (!price || typeof price !== 'string') return 'unknown';
  const p = price.toLowerCase();

  if (p.includes('free')) return 'free';
  if (p.includes('budget')) return 'budget';
  if (p.includes('medium')) return 'medium';

  // Extract numbers (e.g. "50 EGP")
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
  if (userChoice === 'fancy') return true; // Fancy users can see everything
  return true;
}

function recommendPlaces(user, places, limit = 10) {
  const { interests = [], history = [], latest_city, budget } = user;

  // 1. Normalize User Inputs (Lowercase)
  const safeInterests = interests.map((i) => i.toLowerCase());
  const safeCity = latest_city ? latest_city.toLowerCase() : '';

  const results = [];

  for (const place of places) {
    let score = 0;

    // 2. Normalize Place Data
    const placeName = place['Landmark Name (English)'];
    const placeCat = place.category ? place.category.toLowerCase() : '';
    const placeLoc = place.Location ? place.Location.toLowerCase() : '';
    const placePrice = place.price;

    // --- Scoring Logic ---

    // A. Interest Match (Partial & Case Insensitive)
    // Example: User interest "mosque" will match category "Historical Mosques"
    const isInterested = safeInterests.some((interest) =>
      placeCat.includes(interest),
    );
    if (isInterested) score += 3;

    // B. Location Match
    if (safeCity && placeLoc.includes(safeCity)) score += 2;

    // C. Budget Bonus
    // If user is 'fancy' and place is 'fancy', give extra points
    const pLevel = detectPriceLevel(placePrice);
    if (budget === 'fancy' && pLevel === 'fancy') score += 1;

    // D. Demote History
    if (placeName && history.includes(placeName)) score -= 5;

    // --- Filtering ---
    if (!priceAllowed(budget, placePrice)) continue;

    results.push({
      _id: place._id,
      name: placeName,
      city: place.Location, // Return original Case
      category: place.category, // Return original Case
      price: placePrice,
      priceLevel: pLevel,
      score,
      image: place.image || null,
    });
  }

  // Sort by Score (High to Low)
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ==============================
// 3. Controllers
// ==============================

// Get All (Pagination)
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

const createPlace = async (req, res) => {
  try {
    const newPlace = await Place.create(req.body);
    res.status(201).json({ status: 'success', data: { place: newPlace } });
  } catch (err) {
    res.status(400).json({ status: 'fail', message: err.message });
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

// Search
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

// Recommend + Search (Hybrid)
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

// CRUD Routes
app.route('/api/v1/places').get(getAllPlaces).post(createPlace);
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
