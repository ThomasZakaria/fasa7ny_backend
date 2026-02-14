const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema(
  {
    ID: Number,
    'Landmark Name (English)': { type: String, required: true },
    'Arabic Name': String,
    Location: String, // اسم المدينة (نص عادي)
    Coordinates: String, // الإحداثيات القديمة (نص) - سيبناها عشان المرجع
    category: String,
    price: String,
    'Short History Summary': String,

    // ✅ 1. حقل الصور (Cloudinary)
    // ده اللي هيشيل اللينك اللي راجع من Cloudinary
    image: { type: String, default: null },

    // ✅ 2. حقل الخريطة الجديد (GeoJSON)
    // ده أهم جزء عشان ميزة "Near Me" تشتغل
    location: {
      type: {
        type: String,
        enum: ['Point'], // لازم تكون 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [Longitude, Latitude] ترتيبهم مهم
        default: [0, 0],
      },
    },

    // ✅ 3. حقول التقييمات (Reviews)
    // بيتحسبوا أوتوماتيك لما حد يعمل ريفيو
    averageRating: {
      type: Number,
      default: 0,
      set: (val) => Math.round(val * 10) / 10, // بيقرب الرقم لعلامة عشرية واحدة (مثلاً 4.7)
    },
    ratingsQuantity: { type: Number, default: 0 },
  },
  {
    strict: false, // بيسمح بحفظ أي حقول زيادة مش مكتوبة هنا
    timestamps: true, // بيضيف createdAt و updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// 🔥 أهم سطر للخرائط:
// ده الفهرس اللي بيخلي MongoDB يعرف يبحث في الخريطة بسرعة
placeSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Place', placeSchema);
