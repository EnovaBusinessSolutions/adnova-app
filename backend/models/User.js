// backend/models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  onboardingCompletado: { type: Boolean, default: false } // ✅ nombre uniforme con backend
});

module.exports = mongoose.model("User", userSchema);
