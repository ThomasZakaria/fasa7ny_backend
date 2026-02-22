/**
 * Egypt Tour Guide API - Production (MongoDB) Version
 * Optimized for Vercel Deployment
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const mongoose = require('mongoose'); // Added Mongoose
const Fuse = require('fuse.js');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();

// 1. MIDDLEWARE & CORS
app.use(
  cors({
    origin: 'https://fasa7ny-frontend.vercel.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json());

// 2. MONGODB CONNECTION
mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// 3. DATABASE SCHEMAS & TRANSLATOR
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
});
const User = mongoose.model('User', UserSchema);

const ReviewSchema = new mongoose.Schema({
  place: String,
  user: String,
  username: String,
  rating: Number,
  comment: String,
  createdAt: { type: Date, default: Date.now },
});
const Review = mongoose.model('Review', ReviewSchema);

// CHANGED: strict: false allows Mongoose to read custom database fields like "Location"
const PlaceSchema = new mongoose.Schema({}, { strict: false });
const Place = mongoose.model('Place', PlaceSchema);

// NEW: A translator function to convert database labels into frontend labels
const formatPlace = (p) => ({
  id: p._id,
  name: p['Landmark Name (English)'] || p.name,
  category: p.category,
  governorate: p.Location || p.governorate,
  description: p['Short History Summary'] || p.description,
  rating: p.averageRating || p.rating,
  price: p.price,
  image: p['Main Image URL'] || p.image,
});

// 4. CLOUDINARY CONFIG (For AI Landmark Images)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'fasa7ny_uploads',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});
const upload = multer({ storage });

// 5. AUTH ROUTES
app.post('/api/v1/auth/signup', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser)
      return res.status(400).json({ status: 'fail', message: 'User exists' });

    const newUser = await User.create({ username, password, email });
    res.status(201).json({
      status: 'success',
      data: { user: { id: newUser._id, username } },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user)
      return res
        .status(401)
        .json({ status: 'fail', message: 'Invalid credentials' });
    res.status(200).json({
      status: 'success',
      data: { user: { id: user._id, username: user.username } },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 6. SMART SEARCH & PLACES
app.get('/api/v1/places/search', async (req, res) => {
  try {
    const rawPlaces = await Place.find();
    const allPlaces = rawPlaces.map(formatPlace); // Format for frontend
    const { q } = req.query;

    if (!q)
      return res
        .status(200)
        .json({ status: 'success', data: { places: allPlaces } });

    const fuse = new Fuse(allPlaces, {
      keys: ['name', 'governorate', 'category'],
      threshold: 0.3,
    });
    const results = fuse.search(q).map((result) => result.item);

    res.status(200).json({
      status: 'success',
      results: results.length,
      data: { places: results },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 7. AI LANDMARK DETECTION
app.post('/api/v1/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: 'No image uploaded' });

    const imageUrl = req.file.path;

    // AUTOMATIC URL SWAPPING
    const isLocal =
      req.headers.host.includes('localhost') ||
      req.headers.host.includes('127.0.0.1');

    const aiUrl = isLocal
      ? 'http://127.0.0.1:5000/predict'
      : `${process.env.AI_SERVICE_URL}/predict`;

    console.log(`📡 Sending image to AI at: ${aiUrl}`);

    const pythonResponse = await axios.post(aiUrl, { url: imageUrl });

    const landmarkName = pythonResponse.data.landmark;
    const rawPlaces = await Place.find();
    const allPlaces = rawPlaces.map(formatPlace); // Format so Fuse can read "name"
    const fuse = new Fuse(allPlaces, { keys: ['name'], threshold: 0.4 });
    const matchedPlace = fuse.search(landmarkName)[0]?.item;

    res.status(200).json({
      status: 'success',
      landmark: landmarkName,
      matchedPlace: matchedPlace || null,
      imageUrl: imageUrl,
    });
  } catch (err) {
    console.error('AI Error:', err.message);
    res
      .status(500)
      .json({ status: 'error', message: 'AI Service currently unavailable' });
  }
});

// 8. REVIEWS ROUTES
app.get('/api/v1/places/:placeId/reviews', async (req, res) => {
  try {
    const placeReviews = await Review.find({ place: req.params.placeId });
    res.status(200).json({
      status: 'success',
      results: placeReviews.length,
      data: { reviews: placeReviews },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/v1/places/:placeId/reviews', async (req, res) => {
  try {
    const { rating, comment, userId, username } = req.body;
    const newReview = await Review.create({
      place: req.params.placeId,
      user: userId,
      username: username || 'Anonymous',
      rating: Number(rating),
      comment,
    });
    res.status(201).json({ status: 'success', data: { review: newReview } });
  } catch (err) {
    res.status(400).json({ status: 'fail', message: err.message });
  }
});

// 9. CATEGORIES ROUTE
app.get('/api/v1/categories', async (req, res) => {
  try {
    const { city } = req.query;
    let filter = {};

    if (city) {
      // Look in BOTH possible fields to catch the data
      filter.$or = [
        { Location: new RegExp(city, 'i') },
        { governorate: new RegExp(city, 'i') },
      ];
    }

    const places = await Place.find(filter);

    // Extract a list of unique categories from those places
    const categories = [
      ...new Set(places.map((place) => place.category).filter(Boolean)),
    ];

    res.status(200).json({ status: 'success', data: { categories } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// VERCEL EXPORT
module.exports = app;
