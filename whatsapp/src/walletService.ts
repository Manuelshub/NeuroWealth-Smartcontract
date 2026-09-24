import { Keypair } from '@stellar/stellar-sdk';
import { encryptSecretKey, decryptSecretKey } from './cryptoUtils';
import { query } from './db';

export interface UserWallet {
  publicKey: string;
  encryptedSecret: {
    encryptedData: string;
    iv: string;
    tag: string;
  };
  createdAt: number;
}

/**
 * Creates a new custodial Stellar keypair for a verified user and encrypts secret key.
 */
export async function createCustodialWallet(phoneHash: string): Promise<UserWallet> {
  const pair = Keypair.random();
  const publicKey = pair.publicKey();
  const secretKey = pair.secret();

  const encryptedSecret = encryptSecretKey(secretKey);
  const createdAt = Date.now();

  const wallet: UserWallet = {
    publicKey,
    encryptedSecret,
    createdAt
  };

  await query(
    `INSERT INTO whatsapp_wallets (phone_hash, public_key, encrypted_data, iv, tag, created_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
     ON CONFLICT (phone_hash) DO NOTHING`,
    [
      phoneHash,
      publicKey,
      encryptedSecret.encryptedData,
      encryptedSecret.iv,
      encryptedSecret.tag,
      createdAt
    ]
  );

  return wallet;
}

/**
 * Retrieves a user's wallet info (public key and encrypted secret).
 */
export async function getWallet(phoneHash: string): Promise<UserWallet | undefined> {
  const res = await query('SELECT * FROM whatsapp_wallets WHERE phone_hash = $1', [phoneHash]);
  if (res.rows.length === 0) return undefined;

  const row = res.rows[0];
  return {
    publicKey: row.public_key,
    encryptedSecret: {
      encryptedData: row.encrypted_data,
      iv: row.iv,
      tag: row.tag
    },
    createdAt: new Date(row.created_at).getTime()
  };
}

/**
 * Decrypts secret key for transaction execution. Key is never saved in plaintext or output to chat.
 */
export async function getDecryptedSecretKey(phoneHash: string): Promise<string | null> {
  const wallet = await getWallet(phoneHash);
  if (!wallet) return null;

  return decryptSecretKey(
    wallet.encryptedSecret.encryptedData,
    wallet.encryptedSecret.iv,
    wallet.encryptedSecret.tag
  );
}
