const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema(
  {
    ID: Number,
    'Landmark Name (English)': String,
    'Arabic Name': String,
    Location: String,
    Coordinates: String,
    category: String,
    workingTime: String,
    price: String,
    price_source: String,
    'Short History Summary': String,
  },
  { strict: false }
);

module.exports = mongoose.model('Place', placeSchema);
