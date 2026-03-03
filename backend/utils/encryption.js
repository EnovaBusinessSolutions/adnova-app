const crypto = require('crypto');

// Use ENCRYPTION_KEY or a fallback for dev (DO NOT USE FALLBACK IN PROD)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY.substring(0, 64), 'hex')
  : crypto.randomBytes(32); // Creates random key if none provided (will lose data on restart)

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
 * Hash PII (Personally Identifiable Information) like email or phone
 * @param {string} value 
 * @returns {string|null} SHA-256 hex hash
 */
function hashPII(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
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
  hashFingerprint
};
