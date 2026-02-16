/**
 * Place Model - Represents a historical landmark or tourist attraction.
 * Features: GeoJSON support for location-based queries and automated rating calculations.
 */

const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema(
  {
    // --- Basic Information ---
    ID: Number,
    'Landmark Name (English)': {
      type: String,
      required: [true, 'A landmark must have an English name'],
      trim: true,
    },
    'Arabic Name': {
      type: String,
      trim: true,
    },
    Location: String, // City/District name as a human-readable string
    Coordinates: String, // Legacy raw coordinate string for reference
    category: String,
    price: String,
    'Short History Summary': String,

    // --- Media Assets ---
    /** @property {string} image - Remote URL of the image hosted on Cloudinary */
    image: {
      type: String,
      default: null,
    },

    // --- Geospatial Data (GeoJSON) ---
    /** * @property {Object} location - GeoJSON object for geospatial indexing
     * Required for MongoDB $near and $maxDistance queries.
     */
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      /** @property {Number[]} coordinates - [Longitude, Latitude] */
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },

    // --- Aggregated Social Metrics ---
    /** @property {number} averageRating - Calculated mean score from user reviews */
    averageRating: {
      type: Number,
      default: 0,
      min: [0, 'Rating must be above 0'],
      max: [5, 'Rating must be below 5'],
      // Rounds to 1 decimal place (e.g., 4.666 -> 4.7)
      set: (val) => Math.round(val * 10) / 10,
    },
    /** @property {number} ratingsQuantity - Total number of reviews submitted */
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
  },
  {
    // Schema Configuration
    strict: false, // Allows flexibility for legacy data fields not explicitly defined
    timestamps: true, // Automatically manages createdAt and updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/** * GEOSPATIAL INDEX
 * Critical for performance. Enables 2D sphere calculations for "Nearby" features.
 */
placeSchema.index({ location: '2dsphere' });

/**
 * TEXT INDEX (Optional but recommended)
 * Enables efficient keyword searching across names and categories.
 */
placeSchema.index({
  'Landmark Name (English)': 'text',
  'Arabic Name': 'text',
  category: 'text',
});

module.exports = mongoose.model('Place', placeSchema);
