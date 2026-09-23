import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set; refusing to use an unsafe production default`);
  }
  return value;
}

const ENCRYPTION_KEY = requireEnv('ENCRYPTION_KEY');
if (ENCRYPTION_KEY.length < 32) {
  throw new Error('ENCRYPTION_KEY must be at least 32 characters');
}
const PHONE_HASH_SALT = requireEnv('PHONE_HASH_SALT');

/**
 * Hashes phone number to ensure PII privacy at rest.
 * Uses SHA-256 with a deployment-provided salt.
 */
export function hashPhoneNumber(phone: string): string {
  return crypto.createHash('sha256').update(phone + PHONE_HASH_SALT).digest('hex');
}

/**
 * Encrypts sensitive custodial Stellar secret key before saving to storage.
 */
export function encryptSecretKey(secretKey: string): { encryptedData: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(secretKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    tag
  };
}

/**
 * Decrypts encrypted custodial Stellar secret key for transaction signing.
 * Never log or expose the output of this function.
 */
export function decryptSecretKey(encryptedData: string, iv: string, tag: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}