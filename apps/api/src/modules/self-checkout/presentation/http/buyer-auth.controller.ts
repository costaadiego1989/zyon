import { Controller, Post, Body, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { RegisterBuyerUserUseCase, type RegisterBuyerUserInput } from "../../application/use-cases/register-buyer-user.use-case.js";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { Inject } from "@nestjs/common";
import { requireSecret } from "../../../../shared/config/secret-config.js";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt:${salt}:${key.toString("base64url")}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algorithm, salt, stored] = hash.split(":");
  if (algorithm !== "scrypt" || !salt || !stored) return false;
  const expected = Buffer.from(stored, "base64url");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function issueToken(sub: string, email: string): string {
  const secret = requireSecret("BUYER_JWT_SECRET", "buyer-dev-secret");
  const ttl = 7 * 24 * 3600;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, email, aud: "buyer.aacp", iat: now, exp: now + ttl })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

@Controller("buyer")
export class BuyerAuthController {
  constructor(
    private readonly register: RegisterBuyerUserUseCase,
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository
  ) {}

  @Post("register")
  async registerBuyer(@Body() body: RegisterBuyerUserInput) {
    const password_hash = await hashPassword(body.password);
    const result = await this.register.execute({ ...body, password: password_hash });
    return { ...result, token: issueToken(result.user_id, body.email) };
  }

  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.users.findByEmail(body.email);
    if (!user) throw new UnauthorizedException("INVALID_CREDENTIALS");
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) throw new UnauthorizedException("INVALID_CREDENTIALS");
    return { user_id: user.id, token: issueToken(user.id, user.email) };
  }
}
