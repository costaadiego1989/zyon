-- Optional bounded AES-GCM payload for stores without private object storage.
ALTER TABLE "support_attachments" ADD COLUMN "encrypted_payload" BYTEA;
