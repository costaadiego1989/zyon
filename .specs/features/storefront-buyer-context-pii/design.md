# Design

Use the existing shared isPiiEncrypted/decryptPii functions at the raw Prisma
buyerAccount projection in SendStoreMessageUseCase, as the buyer repository does.
Catch decoding errors for the phone only; retain the server-bound buyer id,
name and email. Never include ciphertext or decoded values in diagnostics.
Trusted server context keeps its existing buyer identity equality requirement.
Do not loosen Zod or classify conversation topics with string matching.

Test synthetic ciphertext generated using the real cipher, legacy plaintext,
absent phone and unreadable ciphertext. Assert unchanged response identity,
single generation, no retries and no phone in logs. Diagnose with a stub that
stops before provider and all writes, using actual deployed readers and schema.
