const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema(
  {
    // It is often better to rely on MongoDB's default _id,
    // but if you have a custom ID from a dataset, this is fine.
    ID: Number,
    'Landmark Name (English)': { type: String, required: true },
    'Arabic Name': String,
    Location: String,
    Coordinates: String,
    category: String,
    workingTime: String,
    price: String,
    price_source: String,
    'Short History Summary': String,

    averageRating: {
  type: Number,
  default: 0,
},
ratingsQuantity: {
  type: Number,
  default: 0,
},
  },
  {
    strict: false, // Allows fields not defined here to be saved
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: { virtuals: true }, // Ensure virtuals are included in JSON
    toObject: { virtuals: true },
  },
);

module.exports = mongoose.model('Place', placeSchema);

