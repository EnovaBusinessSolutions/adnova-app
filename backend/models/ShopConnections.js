const mongoose = require('mongoose');

const shopConnSchema = new mongoose.Schema({
  shop:            { type: String, unique: true, required: true }, // midominio.myshopify.com
  accessToken:     { type: String, required: true },
  installedAt:     { type: Date, default: Date.now },
  matchedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

module.exports = mongoose.model('ShopConnections', shopConnSchema);
