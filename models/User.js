const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  scan_history: [
    {
      place_name: String,
      confidence: Number,
      scannedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});

module.exports = mongoose.model('User', userSchema);
