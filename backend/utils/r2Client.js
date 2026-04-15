'use strict';

/**
 * r2Client.js
 * Cloudflare R2 client for session recording storage.
 *
 * R2 key conventions:
 *   Final recording:  recordings/{accountId}/{YYYY-MM}/{recordingId}.rrweb.gz
 *   Per-chunk:        recordings/{accountId}/{recordingId}/chunks/{chunkIndex}.json.gz
 *
 * Exports: uploadChunk, uploadFinal, getPresignedUrl, deleteObject, deletePrefix
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const zlib = require('zlib');

// S3_ENDPOINT: set for Cloudflare R2 (https://<account_id>.r2.cloudflarestorage.com)
//              leave EMPTY for standard AWS S3 (uses native AWS endpoint resolution)
const S3_ENDPOINT = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || null;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || null;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || null;
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const R2_BUCKET = process.env.R2_BUCKET || process.env.S3_BUCKET || 'adray-recordings';

let r2 = null;

if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
  const clientConfig = {
    region: S3_ENDPOINT ? 'auto' : S3_REGION,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  };
  // Only set custom endpoint for R2 or non-AWS S3-compatible storage
  if (S3_ENDPOINT) clientConfig.endpoint = S3_ENDPOINT;

  r2 = new S3Client(clientConfig);
  console.log(`[r2Client] Storage: ${S3_ENDPOINT ? `custom (${S3_ENDPOINT})` : `AWS S3 (${S3_REGION})`} → bucket: ${R2_BUCKET}`);
} else {
  console.warn('[r2Client] No storage credentials found — recording storage disabled.');
}

/**
 * Build the final recording key.
 * @param {string} accountId
 * @param {string} recordingId
 * @returns {string}
 */
function finalKey(accountId, recordingId) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `recordings/${accountId}/${ym}/${recordingId}.rrweb.gz`;
}

/**
 * Build the per-chunk R2 prefix (without trailing slash).
 * @param {string} accountId
 * @param {string} recordingId
 * @returns {string}
 */
function chunksPrefix(accountId, recordingId) {
  return `recordings/${accountId}/${recordingId}/chunks`;
}

/**
 * Build the key for a single chunk.
 * @param {string} prefix
 * @param {number} index
 * @returns {string}
 */
function chunkKey(prefix, index) {
  return `${prefix}/${String(index).padStart(6, '0')}.json.gz`;
}

/**
 * Upload a single rrweb chunk (compressed) to R2.
 * The events array is JSON-stringified then gzip-compressed before upload.
 * @param {string} prefix - r2ChunksPrefix from SessionRecording
 * @param {number} index - chunk index
 * @param {Array} events - raw rrweb events array
 * @returns {Promise<string>} the R2 key of the uploaded chunk
 */
async function uploadChunk(prefix, index, events) {
  if (!r2) return null;
  const key = chunkKey(prefix, index);
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(events)));
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    ContentEncoding: 'gzip',
  }));
  return key;
}

/**
 * Upload a final assembled recording to R2.
 * @param {string} key - the final R2 key (from finalKey())
 * @param {Buffer} gzipBuffer - already-compressed rrweb events
 * @returns {Promise<void>}
 */
async function uploadFinal(key, gzipBuffer) {
  if (!r2) return;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: gzipBuffer,
    ContentType: 'application/json',
    ContentEncoding: 'gzip',
  }));
}

/**
 * Get a presigned URL to read a recording from R2 (for the dashboard player).
 * @param {string} key
 * @param {number} ttlSeconds - default 900 (15 min)
 * @returns {Promise<string>}
 */
async function getPresignedUrl(key, ttlSeconds = 900) {
  if (!r2) return null;
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn: ttlSeconds });
}

/**
 * Delete a single R2 object.
 * @param {string} key
 * @returns {Promise<void>}
 */
async function deleteObject(key) {
  if (!r2 || !key) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.error(`[r2Client] deleteObject failed for ${key}:`, err.message);
  }
}

/**
 * Delete all objects under a given prefix (used for chunk cleanup).
 * Paginates if needed.
 * @param {string} prefix
 * @returns {Promise<number>} count of deleted objects
 */
async function deletePrefix(prefix) {
  if (!r2 || !prefix) return 0;
  let deleted = 0;
  let continuationToken;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (list.Contents || []).map((o) => ({ Key: o.Key }));
    if (objects.length) {
      await r2.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: objects, Quiet: true },
      }));
      deleted += objects.length;
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return deleted;
}

/**
 * Download and decompress events from R2 (used by finalize worker).
 * @param {string} key
 * @returns {Promise<Array>} rrweb events array
 */
async function downloadChunk(key) {
  if (!r2) return [];
  const resp = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  const compressed = Buffer.concat(chunks);
  const raw = zlib.gunzipSync(compressed);
  return JSON.parse(raw.toString('utf8'));
}

/**
 * List all chunk keys under a prefix, sorted by key name (preserves chunk order).
 * @param {string} prefix
 * @returns {Promise<string[]>} sorted array of S3 keys
 */
async function listChunkKeys(prefix) {
  if (!r2) return [];
  const keys = [];
  let continuationToken;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of (list.Contents || [])) keys.push(obj.Key);
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return keys.sort(); // lexicographic = chunk order (000000, 000001, ...)
}

module.exports = {
  r2,
  R2_BUCKET,
  finalKey,
  chunksPrefix,
  chunkKey,
  uploadChunk,
  uploadFinal,
  getPresignedUrl,
  deleteObject,
  deletePrefix,
  downloadChunk,
  listChunkKeys,
};
