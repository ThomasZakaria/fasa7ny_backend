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

// 3. DATABASE SCHEMAS (Replacing JSON files)
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

const PlaceSchema = new mongoose.Schema({
  id: String,
  name: String,
  category: String,
  governorate: String,
  description: String,
  rating: Number,
  price: String,
  image: String,
});
const Place = mongoose.model('Place', PlaceSchema);

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
    const allPlaces = await Place.find();
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
    // Check if we are running locally or on Vercel
    const isLocal =
      req.headers.host.includes('localhost') ||
      req.headers.host.includes('127.0.0.1');

    const aiUrl = isLocal
      ? 'http://127.0.0.1:5000/predict' // Your local Python Flask port
      : `${process.env.AI_SERVICE_URL}/predict`; // Your Vercel AI path

    console.log(`📡 Sending image to AI at: ${aiUrl}`);

    const pythonResponse = await axios.post(aiUrl, { url: imageUrl });

    const landmarkName = pythonResponse.data.landmark;
    const allPlaces = await Place.find();
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

// VERCEL EXPORT
module.exports = app;
