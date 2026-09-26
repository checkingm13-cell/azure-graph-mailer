const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');

let s3ClientInstance = null;

function getS3Client() {
  if (!s3ClientInstance) {
    if (!config.ociS3AccessKey || !config.ociS3SecretKey || !config.ociS3Namespace) {
      throw new Error('OCI S3 credentials (Access Key, Secret Key, or Tenancy Namespace) are not fully configured.');
    }

    const region = config.ociS3Region || 'ap-mumbai-1';
    const endpoint = `https://${config.ociS3Namespace}.compat.objectstorage.${region}.oraclecloud.com`;

    s3ClientInstance = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: config.ociS3AccessKey,
        secretAccessKey: config.ociS3SecretKey
      },
      forcePathStyle: true // Needed for OCI S3-compatible path resolution
    });
  }
  return s3ClientInstance;
}

function getObjectKey(originalName, mimeType = 'image/webp') {
  const ext = path.extname(originalName) || (mimeType === 'image/webp' ? '.webp' : '.png');
  const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `posters/${baseName}${ext}`;
}

function getPublicUrl(objectKey) {
  const region = config.ociS3Region || 'ap-mumbai-1';
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  return `https://objectstorage.${region}.oraclecloud.com/n/${config.ociS3Namespace}/b/${config.ociS3Bucket}/o/${encodedKey}`;
}

/**
 * Checks if an object already exists in OCI Object Storage
 * @param {string} objectKey - e.g. 'posters/filename.webp'
 * @returns {Promise<{ exists: boolean, size?: number, key: string, url: string }>}
 */
async function checkObjectExists(objectKey) {
  if (!config.ociS3Bucket) return { exists: false, key: objectKey, url: getPublicUrl(objectKey) };
  const s3 = getS3Client();
  try {
    const headRes = await s3.send(new HeadObjectCommand({
      Bucket: config.ociS3Bucket,
      Key: objectKey
    }));
    return {
      exists: true,
      size: headRes.ContentLength || 0,
      key: objectKey,
      url: getPublicUrl(objectKey)
    };
  } catch (err) {
    // 404 / NotFound means it doesn't exist yet
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return { exists: false, key: objectKey, url: getPublicUrl(objectKey) };
    }
    // If any other permission/network error occurs, assume doesn't exist so upload continues
    return { exists: false, key: objectKey, url: getPublicUrl(objectKey) };
  }
}

/**
 * Uploads an image or file buffer to Oracle Cloud Object Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} originalName - Original uploaded filename
 * @param {string} mimeType - e.g. 'image/png', 'image/jpeg'
 * @returns {Promise<{ key: string, url: string }>}
 */
async function uploadToOCI(buffer, originalName, mimeType = 'image/png') {
  if (!config.ociS3Bucket) {
    throw new Error('OCI S3 Bucket name (OCI_S3_BUCKET) is not defined in .env.');
  }

  const s3 = getS3Client();
  const objectKey = getObjectKey(originalName, mimeType);

  const command = new PutObjectCommand({
    Bucket: config.ociS3Bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable'
  });

  await s3.send(command);

  return {
    key: objectKey,
    url: getPublicUrl(objectKey)
  };
}

module.exports = {
  uploadToOCI,
  checkObjectExists,
  getObjectKey,
  getPublicUrl,
  getS3Client
};
