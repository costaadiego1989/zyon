import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });
import { createHmac } from "node:crypto";

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const ORIGIN = "http://localhost:5174";
const EMBED_SECRET = process.env.EMBED_TOKEN_SECRET ?? "dev_embed_token_secret_32_characters_min!!";

const now = Math.floor(Date.now() / 1000);
const claims = {
  typ: "aacp_embed_v1",
  merchantId: MERCHANT_ID,
  environment: "test",
  issuedAtUnix: now,
  expiresAtUnix: now + 7200,
  nonce: Math.random().toString(36).slice(2),
  allowedOrigin: ORIGIN,
  scopes: [
    "checkout:start", "checkout:track", "checkout:chat", "offers:apply",
    "coupons:apply", "payment:intents:create", "payment:intents:confirm", "payment:intents:read",
  ],
};
const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
const sig = createHmac("sha256", Buffer.from(EMBED_SECRET, "utf8")).update(payload).digest("base64url");
const token = `${payload}.${sig}`;

const url = `http://localhost:5174/?embedToken=${encodeURIComponent(token)}&merchantId=${MERCHANT_ID}&apiBaseUrl=${encodeURIComponent("http://localhost:3009")}&globalUserId=${encodeURIComponent("costaadiego1989@gmail.com")}`;
console.log("WIDGET_URL:");
console.log(url);
