'use strict';

const mongoose = require('mongoose');

const WooConnectionsSchema = new mongoose.Schema({
    shop: { type: String, required: true, unique: true }, // tienda dominio ej. tienda.example.com
    accessToken: { type: String, required: true, select: false }, // token generado por el servidor
    pluginVersion: { type: String },
    adminEmail: { type: String },
    installedAt: { type: Date, default: Date.now },
    matchedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { collection: 'wooconnections' });

module.exports = mongoose.models.WooConnections || mongoose.model('WooConnections', WooConnectionsSchema);
