const { Schema, model, Types } = require('mongoose');

const AdAccountSchema = new Schema({
  id: String,               // p.ej. "act_123..."
  account_id: String,       // "123..."
  name: String,
  currency: String,
  configured_status: String
}, { _id: false });

const MetaAccountSchema = new Schema({
  userId:           { type: Types.ObjectId, ref: 'User', index: true, required: true },
  accessToken:      { type: String },        // token corto (opcional si guardas el largo)
  longLivedToken:   { type: String },        // token largo (recomendado)
  expiresAt:        { type: Date },          // opcional si gestionas expiración
  adAccounts:       [AdAccountSchema],       // lista obtenida de /me/adaccounts
  defaultAccountId: { type: String },        // "123..." (sin "act_")
  createdAt:        { type: Date, default: Date.now },
  updatedAt:        { type: Date, default: Date.now }
});

MetaAccountSchema.index({ userId: 1 }, { unique: true });

MetaAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = model('MetaAccount', MetaAccountSchema);
