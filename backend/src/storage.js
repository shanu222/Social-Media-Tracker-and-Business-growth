import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config, r2Enabled } from './config.js';

// Cloudflare R2 through its S3-compatible API. The bucket must stay PRIVATE;
// files are only reachable through short-lived signed URLs handed out by the
// API after the user is authenticated.
const client = r2Enabled
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    })
  : null;

export const storageEnabled = r2Enabled;

function ensure() {
  if (!client) {
    const err = new Error('Cloud storage is not configured. Add the R2_* variables on Railway.');
    err.status = 503;
    throw err;
  }
}

export async function putObject(key, body, contentType) {
  ensure();
  await client.send(
    new PutObjectCommand({ Bucket: config.r2.bucket, Key: key, Body: body, ContentType: contentType })
  );
  return key;
}

export async function deleteObject(key) {
  ensure();
  await client.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));
}

export async function signedDownloadUrl(key, filename, seconds = 300) {
  ensure();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    }),
    { expiresIn: seconds }
  );
}
