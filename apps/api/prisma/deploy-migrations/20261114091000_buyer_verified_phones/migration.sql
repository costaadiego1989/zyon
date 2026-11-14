CREATE TABLE buyer_verified_phones (
  phone TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  verification_id TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT buyer_verified_phone_format CHECK (phone ~ '^55[1-9][0-9]{9,10}$')
);
CREATE INDEX buyer_verified_phones_buyer_idx ON buyer_verified_phones(buyer_id);