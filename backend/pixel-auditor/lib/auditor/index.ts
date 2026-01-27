/**
 * Pixel Auditor AI™ - Auditor Module
 * Exports all auditor-related functionality
 */

// Detection functions
export { detectGA4, isValidGA4Id, extractGA4Config } from './ga4';
export { detectGTM, isValidGTMId, analyzeDataLayer } from './gtm';
export { detectMetaPixel, isValidPixelId, detectPixelVersion } from './metaPixel';
export { detectGoogleAds, isValidGoogleAdsId, extractGoogleAdsConfig } from './googleAds';
export { extractEvents } from './events';

// Error descriptions
export {
  GA4_ERRORS,
  GTM_ERRORS,
  META_PIXEL_ERRORS,
  GOOGLE_ADS_ERRORS,
  getErrorDetails,
  getErrorsDetails,
  type ErrorDetail,
} from './errorDescriptions';

// Event descriptions
export {
  META_PIXEL_EVENTS,
  GA4_EVENTS,
  GTM_EVENTS,
  getEventDetails,
  analyzeEventParams,
  type EventDetail,
  type ParamDetail,
} from './eventDescriptions';