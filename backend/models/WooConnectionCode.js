'use strict';

const mongoose = require('mongoose');

/**
 * WooConnectionCode Schema
 * 
 * Temporary codes used to link WooCommerce stores to ADRAY users.
 * Flow:
 * 1. User logs into ADRAY, clicks "Connect WooCommerce"
 * 2. Server generates a unique code and stores it with userId
 * 3. User downloads plugin, enters code in WordPress plugin settings
 * 4. Plugin sends code during install
 * 5. Server validates code, links store to user, deletes the code
 */
const WooConnectionCodeSchema = new mongoose.Schema({
    // The unique connection code (6 chars, alphanumeric)
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        index: true
    },

    // User who requested this code
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // When the code was created
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 3600 // Auto-delete after 1 hour (TTL index)
    },

    // Whether it's been used
    used: {
        type: Boolean,
        default: false
    }
});

// Generate a random 6-character code
WooConnectionCodeSchema.statics.generateCode = function () {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, 0, I, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

// Create a new connection code for a user
WooConnectionCodeSchema.statics.createForUser = async function (userId) {
    // Delete any existing codes for this user
    await this.deleteMany({ userId });

    // Generate unique code
    let code, attempts = 0;
    while (attempts < 10) {
        code = this.generateCode();
        const exists = await this.findOne({ code });
        if (!exists) break;
        attempts++;
    }

    // Create and return
    const connectionCode = new this({ code, userId });
    await connectionCode.save();
    return connectionCode;
};

// Validate and consume a code
WooConnectionCodeSchema.statics.validateAndConsume = async function (code) {
    const connectionCode = await this.findOne({
        code: code.toUpperCase(),
        used: false
    });

    if (!connectionCode) {
        return null;
    }

    // Mark as used and return
    connectionCode.used = true;
    await connectionCode.save();

    return connectionCode;
};

module.exports = mongoose.model('WooConnectionCode', WooConnectionCodeSchema);
