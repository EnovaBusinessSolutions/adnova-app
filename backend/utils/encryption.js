const crypto = require('crypto');

// Use ENCRYPTION_KEY or a fallback for dev (DO NOT USE FALLBACK IN PROD)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY.substring(0, 64), 'hex')
  : crypto.randomBytes(32); // Creates random key if none provided (will lose data on restart)

// HMAC keys for PII hashing (separate keys per identifier type for security).
// If not set, falls back to a derived key from ENCRYPTION_KEY so existing
// SHA-256 hashes will NOT match — run migrate-hmac-hashes.js after setting these.
const HMAC_EMAIL_KEY = process.env.HMAC_EMAIL_KEY
  ? Buffer.from(process.env.HMAC_EMAIL_KEY, 'hex')
  : null;

const HMAC_PHONE_KEY = process.env.HMAC_PHONE_KEY
  ? Buffer.from(process.env.HMAC_PHONE_KEY, 'hex')
  : null;

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a string using AES-256-GCM
 * @param {string} text - The text to encrypt
 * @returns {string} iv:authTag:ciphertext (all in hex)
 */
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a packed string created by encrypt()
 * @param {string} packed - iv:authTag:ciphertext
 * @returns {string} The decrypted text
 */
function decrypt(packed) {
  if (!packed) return null;
  try {
    const parts = packed.split(':');
    if (parts.length !== 3) throw new Error('Invalid packed format');
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return null;
  }
}

/**
 * Hash PII (Personally Identifiable Information) using HMAC-SHA-256.
 * Falls back to unsalted SHA-256 if no HMAC key is configured (legacy compat).
 *
 * IMPORTANT: Set HMAC_EMAIL_KEY and HMAC_PHONE_KEY env vars in production.
 * After setting them, run backend/scripts/migrate-hmac-hashes.js to re-hash
 * existing identity_graph records.
 *
 * @param {string} value
 * @param {Buffer|null} hmacKey - key buffer from HMAC_EMAIL_KEY or HMAC_PHONE_KEY
 * @returns {string|null} HMAC-SHA-256 hex hash (or SHA-256 fallback)
 */
function hashPII(value, hmacKey = null) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (hmacKey) {
    return crypto.createHmac('sha256', hmacKey).update(normalized).digest('hex');
  }
  // Legacy fallback — unsalted SHA-256 (only used if HMAC keys not configured)
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Hash an email address with HMAC-SHA-256 (uses HMAC_EMAIL_KEY if set).
 * @param {string} email
 * @returns {string|null}
 */
function hashEmail(email) {
  return hashPII(email, HMAC_EMAIL_KEY);
}

/**
 * Hash a phone number with HMAC-SHA-256 (uses HMAC_PHONE_KEY if set).
 * @param {string} phone
 * @returns {string|null}
 */
function hashPhone(phone) {
  return hashPII(phone, HMAC_PHONE_KEY);
}

/**
 * Compute a fingerprint hash
 * @param {string} userAgent 
 * @param {string} ip 
 * @param {string} timezone 
 * @param {string} language 
 * @returns {string} SHA-256 hex hash
 */
function hashFingerprint(userAgent, ip, timezone, language) {
  const parts = [
    userAgent || '',
    ip || '',
    timezone || '',
    language || ''
  ].join('|');
  
  return crypto.createHash('sha256').update(parts).digest('hex');
}

module.exports = {
  encrypt,
  decrypt,
  hashPII,
  hashEmail,
  hashPhone,
  hashFingerprint,
  HMAC_EMAIL_KEY,
  HMAC_PHONE_KEY,
};
