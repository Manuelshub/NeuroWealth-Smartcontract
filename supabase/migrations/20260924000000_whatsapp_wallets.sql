CREATE TABLE IF NOT EXISTS whatsapp_wallets (
    phone_hash TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
