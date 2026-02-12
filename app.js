const express = require('express');
const app = express();
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const Place = require('./models/Place');

const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// ================================
// MONGODB CONNECTION
// ================================
mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ MongoDB Atlas Connected'))
  .catch((err) => console.error('❌ MongoDB Atlas Error:', err));

// ================================
// TOURS (OLD TRAINING PART)
// ================================
// const tours = JSON.parse(
//   fs.readFileSync(`${__dirname}/dev-data/data/tours.json`, 'utf8'),
// );

const getAllTours = async (req, res) => {
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

// 2. تجيب مكان واحد بالـ ID
const getTour = async (req, res) => {
  try {
    const tour = await Place.findById(req.params._id);
    if (!tour)
      return res.status(404).json({ status: 'fail', message: 'Invalid ID' });

    res.status(200).json({ status: 'success', data: { tour } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// 3. إضافة مكان جديد للمونجو
const createTour = async (req, res) => {
  try {
    const newPlace = await Place.create(req.body);
    res.status(201).json({
      status: 'success',
      data: { tour: newPlace },
    });
  } catch (err) {
    res.status(400).json({ status: 'fail', message: err.message });
  }
};

// 4. تحديث مكان موجود
const updateTour = async (req, res) => {
  try {
    const tour = await Place.findByIdAndUpdate(req.params._id, req.body, {
      new: true, // عشان يرجعلك البيانات بعد التعديل
      runValidators: true, // عشان يتأكد إن البيانات الجديدة صحيحة
    });

    if (!tour)
      return res.status(404).json({ status: 'fail', message: 'Invalid ID' });

    res.status(200).json({
      status: 'success',
      data: { tour },
    });
  } catch (err) {
    res.status(404).json({ status: 'fail', message: err.message });
  }
};

// 5. مسح مكان
const deleteTour = async (req, res) => {
  try {
    const tour = await Place.findByIdAndDelete(req.params._id);

    if (!tour)
      return res.status(404).json({ status: 'fail', message: 'Invalid ID' });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (err) {
    res.status(404).json({ status: 'fail', message: err.message });
  }
};

app.route('/api/v1/tours').get(getAllTours).post(createTour);

app
  .route('/api/v1/tours/:_id')
  .get(getTour)
  .patch(updateTour)
  .delete(deleteTour);

// ================================
// ✅✅✅ RECOMMENDATION SYSTEM
// ================================

// 🔹 Convert any price to level: free | budget | medium | fancy
function detectPriceLevel(price) {
  if (!price || typeof price !== 'string') return 'unknown';

  const p = price.toLowerCase();

  if (p.includes('free')) return 'free';
  if (p.includes('budget')) return 'budget';
  if (p.includes('medium')) return 'medium';

  // For prices like: 60EGP / 540EGP
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

// 🔹 Check if price is allowed based on user choice
function priceAllowed(userChoice, placePrice) {
  // ✅ لو المستخدم بعت رقم أو 0 أو null → اعتبره fancy
  if (!userChoice || typeof userChoice === 'number') {
    return true;
  }

  const level = detectPriceLevel(placePrice);

  if (userChoice === 'budget') {
    return level === 'free' || level === 'budget';
  }

  if (userChoice === 'medium') {
    return level === 'free' || level === 'budget' || level === 'medium';
  }

  if (userChoice === 'fancy') {
    return true;
  }

  return true;
}

// 🔹 Main Recommendation Function
function recommendPlaces(user, places, limit = 10) {
  const { interests = [], history = [], latest_city, budget } = user;

  const results = [];

  for (const place of places) {
    let score = 0;

    // ✅ Interest
    if (interests.includes(place.category)) score += 3;

    // ✅ City
    if (latest_city && place.Location === latest_city) score += 2;

    // ✅ History (avoid repeats)
    if (history.includes(place['Landmark Name (English)'])) score -= 5;

    // ✅ Budget Filter
    if (!priceAllowed(budget, place.price)) continue;

    results.push({
      name: place['Landmark Name (English)'],
      city: place.Location,
      category: place.category,
      price: place.price, // ✅ return ORIGINAL price
      priceLevel: detectPriceLevel(place.price),
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ================================
// ✅ RECOMMEND API
// ================================
app.post('/api/v1/recommend', async (req, res) => {
  try {
    const userProfile = req.body;

    const places = await Place.find().lean();

    console.log('✅ FIRST PLACE FROM DB:', places[0]);

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

// ================================
// SERVER
// ================================
app.listen(3000, () => console.log('✅ app listening on port 3000'));
