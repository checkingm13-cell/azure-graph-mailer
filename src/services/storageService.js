const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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

  const ext = path.extname(originalName) || (mimeType === 'image/webp' ? '.webp' : '.png');
  const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_.-]/g, '_');
  // Keep the exact original name requested by the user
  const objectKey = `posters/${baseName}${ext}`;

  const command = new PutObjectCommand({
    Bucket: config.ociS3Bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable'
  });

  await s3.send(command);

  // Standard public URL for OCI Object Storage
  const region = config.ociS3Region || 'ap-mumbai-1';
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const publicUrl = `https://objectstorage.${region}.oraclecloud.com/n/${config.ociS3Namespace}/b/${config.ociS3Bucket}/o/${encodedKey}`;

  return {
    key: objectKey,
    url: publicUrl
  };
}

module.exports = {
  uploadToOCI,
  getS3Client
};
