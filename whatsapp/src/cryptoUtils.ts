import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set; refusing to use an unsafe production default`);
  }
  return value;
}

export function assertConfig(): void {
  const key = getEnv('ENCRYPTION_KEY');
  if (key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  }
  getEnv('PHONE_HASH_SALT');
}

/**
 * Hashes phone number to ensure PII privacy at rest.
 * Uses SHA-256 with a deployment-provided salt.
 */
export function hashPhoneNumber(phone: string): string {
  const salt = getEnv('PHONE_HASH_SALT');
  const hashedSalt = crypto.createHash('sha256').update(salt).digest('hex');
  return crypto.createHash('sha256').update(phone + hashedSalt).digest('hex');
}

/**
 * Encrypts sensitive custodial Stellar secret key before saving to storage.
 */
export function encryptSecretKey(secretKey: string): { encryptedData: string; iv: string; tag: string } {
  const encryptionKey = getEnv('ENCRYPTION_KEY');
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);
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
  const encryptionKey = getEnv('ENCRYPTION_KEY');
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}