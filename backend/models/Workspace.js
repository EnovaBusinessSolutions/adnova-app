// backend/models/Workspace.js
'use strict';

const mongoose = require('mongoose');

const WORKSPACE_ICONS = [
  'SHOPPING_BAG',
  'LIGHTNING',
  'TARGET',
  'ROCKET',
  'LIGHTBULB',
  'FIRE',
  'LEAF',
  'DIAMOND',
];

const INDUSTRY_VERTICALS = [
  'ECOMMERCE_FASHION',
  'ECOMMERCE_BEAUTY',
  'ECOMMERCE_HOME_DECOR',
  'ECOMMERCE_FOOD_BEVERAGE',
  'ECOMMERCE_HEALTH_WELLNESS',
  'ECOMMERCE_ELECTRONICS',
  'ECOMMERCE_BABY_KIDS',
  'ECOMMERCE_PETS',
  'ECOMMERCE_SPORTS_OUTDOORS',
  'ECOMMERCE_JEWELRY',
  'ECOMMERCE_AUTOMOTIVE',
  'DTC_SUBSCRIPTION',
  'AGENCY',
  'MARKETPLACE',
  'OTHER',
];

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const workspaceSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      minlength: 1,
      maxlength: 48,
      validate: {
        validator: (v) => SLUG_REGEX.test(v),
        message: 'Slug inválido (solo lowercase, números, guiones).',
      },
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 64,
    },

    icon: {
      type: String,
      enum: WORKSPACE_ICONS,
      default: 'SHOPPING_BAG',
    },

    industryVertical: {
      type: String,
      enum: [...INDUSTRY_VERTICALS, null],
      default: null,
    },

    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    plan: {
      type: String,
      enum: ['gratis', 'emprendedor', 'crecimiento', 'pro', 'enterprise'],
      default: 'gratis',
      index: true,
    },

    stripeCustomerId: {
      type: String,
      default: null,
    },

    onboardingComplete: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

workspaceSchema.statics.SLUG_REGEX = SLUG_REGEX;
workspaceSchema.statics.WORKSPACE_ICONS = WORKSPACE_ICONS;
workspaceSchema.statics.INDUSTRY_VERTICALS = INDUSTRY_VERTICALS;

module.exports = mongoose.model('Workspace', workspaceSchema);
