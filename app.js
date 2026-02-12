const express = require('express');
const app = express();
const multer = require('multer');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Place = require('./models/Place');

const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// Connect to MongoDB Atlas
mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ MongoDB Atlas Connected'))
  .catch((err) => console.error('❌ MongoDB Atlas Error:', err));

// ==============================
// CRUD Controllers
// ==============================

// Get all places
const getAllPlaces = async (req, res) => {
  try {
    const places = await Place.find();
    res.status(200).json({
      status: 'success',
      results: places.length,
      data: { places },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get a single place by ID
const getPlace = async (req, res) => {
  try {
    const place = await Place.findById(req.params._id);
    if (!place) {
      return res.status(404).json({ status: 'fail', message: 'Invalid ID' });
    }
    res.status(200).json({ status: 'success', data: { place } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Create a new place
const createPlace = async (req, res) => {
  try {
    const newPlace = await Place.create(req.body);
    res.status(201).json({
      status: 'success',
      data: { place: newPlace },
    });
  } catch (err) {
    res.status(400).json({ status: 'fail', message: err.message });
  }
};

// Update an existing place
const updatePlace = async (req, res) => {
  try {
    const place = await Place.findByIdAndUpdate(req.params._id, req.body, {
      new: true, // Return the updated document
      runValidators: true, // Ensure data matches schema
    });

    if (!place) {
      return res.status(404).json({ status: 'fail', message: 'Invalid ID' });
    }

    res.status(200).json({
      status: 'success',
      data: { place },
    });
  } catch (err) {
    res.status(404).json({ status: 'fail', message: err.message });
  }
};

// Delete a place
const deletePlace = async (req, res) => {
  try {
    const place = await Place.findByIdAndDelete(req.params._id);

    if (!place) {
      return res.status(404).json({ status: 'fail', message: 'Invalid ID' });
    }

    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (err) {
    res.status(404).json({ status: 'fail', message: err.message });
  }
};

// ==============================
// Routes
// ==============================

app.route('/api/v1/places').get(getAllPlaces).post(createPlace);

app
  .route('/api/v1/places/:_id')
  .get(getPlace)
  .patch(updatePlace)
  .delete(deletePlace);

// ==============================
// Recommendation Engine
// ==============================

// Helper: Categorize price string into a level (free, budget, medium, fancy)
function detectPriceLevel(price) {
  if (!price || typeof price !== 'string') return 'unknown';

  const p = price.toLowerCase();
  if (p.includes('free')) return 'free';
  if (p.includes('budget')) return 'budget';
  if (p.includes('medium')) return 'medium';

  // Extract numeric value from string (e.g., "60EGP")
  const numbers = p.match(/\d+/g);
  if (numbers && numbers.length > 0) {
    const min = parseInt(numbers[0]);
    if (min === 0) return 'free';
    if (min <= 60) return 'budget';
    if (min <= 150) return 'medium';
    return 'fancy';
  }

  return 'unknown';
}

// Helper: Filter logic based on user budget
function priceAllowed(userChoice, placePrice) {
  // If no preference or invalid input, allow all (default to fancy/all access)
  if (!userChoice || typeof userChoice === 'number') return true;

  const level = detectPriceLevel(placePrice);

  if (userChoice === 'budget') {
    return level === 'free' || level === 'budget';
  }
  if (userChoice === 'medium') {
    return level === 'free' || level === 'budget' || level === 'medium';
  }
  // 'fancy' users see everything
  return true;
}

// Core Logic: Scoring system for places
function recommendPlaces(user, places, limit = 10) {
  const { interests = [], history = [], latest_city, budget } = user;
  const results = [];

  for (const place of places) {
    let score = 0;

    // 1. Interest Match (+3 points)
    if (interests.includes(place.category)) score += 3;

    // 2. Location Match (+2 points)
    if (latest_city && place.Location === latest_city) score += 2;

    // 3. History Check (-5 points to avoid repetition)
    if (history.includes(place['Landmark Name (English)'])) score -= 5;

    // 4. Budget Filter (Exclude if too expensive)
    if (!priceAllowed(budget, place.price)) continue;

    results.push({
      name: place['Landmark Name (English)'],
      city: place.Location,
      category: place.category,
      price: place.price,
      priceLevel: detectPriceLevel(place.price),
      score,
    });
  }

  // Sort by score (descending) and return top results
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Recommendation Endpoint
app.post('/api/v1/recommend', async (req, res) => {
  try {
    const userProfile = req.body;

    // Fetch all places (lean for performance)
    const places = await Place.find().lean();

    const recommendations = recommendPlaces(userProfile, places, 10);

    res.json({
      status: 'success',
      recommendations,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
});

// Start Server
app.listen(3000, () => console.log('✅ App listening on port 3000'));
