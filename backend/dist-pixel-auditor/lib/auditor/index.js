"use strict";
/**
 * Pixel Auditor AI™ - Auditor Module
 * Exports all auditor-related functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeEventParams = exports.getEventDetails = exports.GTM_EVENTS = exports.GA4_EVENTS = exports.META_PIXEL_EVENTS = exports.getErrorsDetails = exports.getErrorDetails = exports.GOOGLE_ADS_ERRORS = exports.META_PIXEL_ERRORS = exports.GTM_ERRORS = exports.GA4_ERRORS = exports.extractEvents = exports.extractGoogleAdsConfig = exports.isValidGoogleAdsId = exports.detectGoogleAds = exports.detectPixelVersion = exports.isValidPixelId = exports.detectMetaPixel = exports.analyzeDataLayer = exports.isValidGTMId = exports.detectGTM = exports.extractGA4Config = exports.isValidGA4Id = exports.detectGA4 = void 0;
// Detection functions
var ga4_1 = require("./ga4");
Object.defineProperty(exports, "detectGA4", { enumerable: true, get: function () { return ga4_1.detectGA4; } });
Object.defineProperty(exports, "isValidGA4Id", { enumerable: true, get: function () { return ga4_1.isValidGA4Id; } });
Object.defineProperty(exports, "extractGA4Config", { enumerable: true, get: function () { return ga4_1.extractGA4Config; } });
var gtm_1 = require("./gtm");
Object.defineProperty(exports, "detectGTM", { enumerable: true, get: function () { return gtm_1.detectGTM; } });
Object.defineProperty(exports, "isValidGTMId", { enumerable: true, get: function () { return gtm_1.isValidGTMId; } });
Object.defineProperty(exports, "analyzeDataLayer", { enumerable: true, get: function () { return gtm_1.analyzeDataLayer; } });
var metaPixel_1 = require("./metaPixel");
Object.defineProperty(exports, "detectMetaPixel", { enumerable: true, get: function () { return metaPixel_1.detectMetaPixel; } });
Object.defineProperty(exports, "isValidPixelId", { enumerable: true, get: function () { return metaPixel_1.isValidPixelId; } });
Object.defineProperty(exports, "detectPixelVersion", { enumerable: true, get: function () { return metaPixel_1.detectPixelVersion; } });
var googleAds_1 = require("./googleAds");
Object.defineProperty(exports, "detectGoogleAds", { enumerable: true, get: function () { return googleAds_1.detectGoogleAds; } });
Object.defineProperty(exports, "isValidGoogleAdsId", { enumerable: true, get: function () { return googleAds_1.isValidGoogleAdsId; } });
Object.defineProperty(exports, "extractGoogleAdsConfig", { enumerable: true, get: function () { return googleAds_1.extractGoogleAdsConfig; } });
var events_1 = require("./events");
Object.defineProperty(exports, "extractEvents", { enumerable: true, get: function () { return events_1.extractEvents; } });
// Error descriptions
var errorDescriptions_1 = require("./errorDescriptions");
Object.defineProperty(exports, "GA4_ERRORS", { enumerable: true, get: function () { return errorDescriptions_1.GA4_ERRORS; } });
Object.defineProperty(exports, "GTM_ERRORS", { enumerable: true, get: function () { return errorDescriptions_1.GTM_ERRORS; } });
Object.defineProperty(exports, "META_PIXEL_ERRORS", { enumerable: true, get: function () { return errorDescriptions_1.META_PIXEL_ERRORS; } });
Object.defineProperty(exports, "GOOGLE_ADS_ERRORS", { enumerable: true, get: function () { return errorDescriptions_1.GOOGLE_ADS_ERRORS; } });
Object.defineProperty(exports, "getErrorDetails", { enumerable: true, get: function () { return errorDescriptions_1.getErrorDetails; } });
Object.defineProperty(exports, "getErrorsDetails", { enumerable: true, get: function () { return errorDescriptions_1.getErrorsDetails; } });
// Event descriptions
var eventDescriptions_1 = require("./eventDescriptions");
Object.defineProperty(exports, "META_PIXEL_EVENTS", { enumerable: true, get: function () { return eventDescriptions_1.META_PIXEL_EVENTS; } });
Object.defineProperty(exports, "GA4_EVENTS", { enumerable: true, get: function () { return eventDescriptions_1.GA4_EVENTS; } });
Object.defineProperty(exports, "GTM_EVENTS", { enumerable: true, get: function () { return eventDescriptions_1.GTM_EVENTS; } });
Object.defineProperty(exports, "getEventDetails", { enumerable: true, get: function () { return eventDescriptions_1.getEventDetails; } });
Object.defineProperty(exports, "analyzeEventParams", { enumerable: true, get: function () { return eventDescriptions_1.analyzeEventParams; } });
