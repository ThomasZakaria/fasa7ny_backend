const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema(
  {
    ID: Number,
    'Landmark Name (English)': { type: String, required: true },
    'Arabic Name': String,
    Location: String,
    Coordinates: String,
    category: String,
    price: String,
    'Short History Summary': String,

    // ✅ حقل الصور (كان ناقص)
    image: { type: String, default: null },

    // ✅ حقول التقييمات
    averageRating: {
      type: Number,
      default: 0,
      set: (val) => Math.round(val * 10) / 10,
    },
    ratingsQuantity: { type: Number, default: 0 },
  },
  {
    strict: false,
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

module.exports = mongoose.model('Place', placeSchema);
