import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { TwilioOnboardingError, type TwilioAccount, type TwilioOnboarding, type TwilioSender } from "../../domain/ports/whatsapp-onboarding.port.js";
import { twilioWhatsAppCallbackUrl } from "../../domain/services/public-url.js";

const ACCOUNTS = "https://api.twilio.com/2010-04-01/Accounts.json";
const SENDERS = "https://messaging.twilio.com/v2/Channels/Senders";
const accountPattern = /^AC[0-9a-f]{32}$/i;
const senderPattern = /^XE[0-9a-f]{32}$/i;

@Injectable()
export class TwilioOnboardingAdapter implements TwilioOnboarding {
  parentAccountSid() { return process.env.TWILIO_ACCOUNT_SID?.trim() ?? ""; }
  private parent(): TwilioAccount {
    const accountSid = this.parentAccountSid();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
    if (!accountPattern.test(accountSid) || !authToken) throw new TwilioOnboardingError("PLATFORM_NOT_CONFIGURED");
    return { accountSid, authToken };
  }
  settings() {
    const appId = (process.env.TWILIO_EMBEDDED_SIGNUP_APP_ID ?? process.env.META_APP_ID ?? "").trim();
    const configId = (process.env.TWILIO_EMBEDDED_SIGNUP_CONFIGURATION_ID ?? "").trim();
    const solutionId = (process.env.TWILIO_PARTNER_SOLUTION_ID ?? "").trim();
    const callback = twilioWhatsAppCallbackUrl();
    const configured = [appId, configId, solutionId].every(value => /^\d{5,40}$/.test(value))
      && accountPattern.test(this.parentAccountSid()) && Boolean(process.env.TWILIO_AUTH_TOKEN?.trim())
      && Boolean(process.env.META_APP_SECRET?.trim())
      && Boolean(callback?.startsWith("https://"))
      && (process.env.NODE_ENV !== "production" || Boolean(process.env.AACP_PII_ENC_KEY?.trim()));
    return { appId, configId, solutionId, configured };
  }
  private async request<T>(url: string, account: TwilioAccount, init: RequestInit = {}): Promise<T> {
    const write = init.method === "POST";
    try {
      const response = await fetch(url, {
        ...init, redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { ...init.headers, Authorization: "Basic " + Buffer.from(account.accountSid + ":" + account.authToken).toString("base64") },
      });
      if (!response.ok) throw new TwilioOnboardingError("TWILIO_HTTP_" + response.status, write && response.status >= 500);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof TwilioOnboardingError) throw error;
      throw new TwilioOnboardingError("TWILIO_UNAVAILABLE", write);
    }
  }
  private accountName(merchantId: string) { return "zyon-wa-" + createHash("sha256").update(merchantId).digest("hex"); }
  private parseAccount(data: any): TwilioAccount {
    if (!accountPattern.test(data?.sid) || data.sid === this.parentAccountSid()
      || data.owner_account_sid !== this.parentAccountSid() || data.status !== "active" || !data.auth_token) {
      throw new TwilioOnboardingError("TWILIO_ACCOUNT_REVIEW_REQUIRED", true);
    }
    return { accountSid: data.sid, authToken: data.auth_token };
  }
  private nextPage(next: unknown, base: string): string | null {
    if (next == null) return null;
    if (typeof next !== "string") throw new TwilioOnboardingError("TWILIO_INVALID_RESPONSE");
    const url = new URL(next, base);
    const allowed = new URL(base);
    if (url.origin !== allowed.origin || url.pathname !== allowed.pathname || url.username || url.password) {
      throw new TwilioOnboardingError("TWILIO_INVALID_RESPONSE");
    }
    return url.toString();
  }
  async findAccount(merchantId: string): Promise<TwilioAccount | null> {
    const name = this.accountName(merchantId);
    const query = new URL(ACCOUNTS);
    query.searchParams.set("FriendlyName", name);
    query.searchParams.set("PageSize", "100");
    let url: string | null = query.toString();
    const matches: any[] = [];
    for (let page = 0; url && page < 3; page++) {
      const result: any = await this.request(url, this.parent());
      if (!Array.isArray(result.accounts)) throw new TwilioOnboardingError("TWILIO_INVALID_RESPONSE");
      matches.push(...result.accounts.filter((item: any) => item.friendly_name === name));
      url = this.nextPage(result.next_page_uri, ACCOUNTS);
    }
    if (url || matches.length > 1) throw new TwilioOnboardingError("TWILIO_ACCOUNT_REVIEW_REQUIRED");
    return matches.length ? this.parseAccount(matches[0]) : null;
  }
  async createAccount(merchantId: string) {
    return this.parseAccount(await this.request(ACCOUNTS, this.parent(), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ FriendlyName: this.accountName(merchantId) }).toString(),
    }));
  }
  private parseSender(data: any): TwilioSender {
    if (!senderPattern.test(data?.sid) || typeof data.sender_id !== "string"
      || typeof data.status !== "string" || typeof data.configuration?.waba_id !== "string") {
      throw new TwilioOnboardingError("TWILIO_INVALID_RESPONSE", true);
    }
    return { sid: data.sid, sender_id: data.sender_id, status: data.status, configuration: { waba_id: data.configuration.waba_id } };
  }
  private subaccount(account: TwilioAccount) {
    if (!accountPattern.test(account.accountSid) || account.accountSid === this.parentAccountSid() || !account.authToken) {
      throw new TwilioOnboardingError("TWILIO_ACCOUNT_REVIEW_REQUIRED");
    }
    return account;
  }
  async findSender(account: TwilioAccount, phone: string) {
    let url: string | null = SENDERS + "?Channel=whatsapp&PageSize=100";
    const matches: TwilioSender[] = [];
    for (let page = 0; url && page < 3; page++) {
      const result: any = await this.request(url, this.subaccount(account));
      if (!Array.isArray(result.senders)) throw new TwilioOnboardingError("TWILIO_INVALID_RESPONSE");
      for (const sender of result.senders) if (sender.sender_id === "whatsapp:" + phone) matches.push(this.parseSender(sender));
      url = this.nextPage(result.meta?.next_page_url, SENDERS);
    }
    if (url || matches.length > 1) throw new TwilioOnboardingError("TWILIO_SENDER_REVIEW_REQUIRED");
    return matches[0] ?? null;
  }
  async createSender(account: TwilioAccount, phone: string, wabaId: string) {
    const callback = twilioWhatsAppCallbackUrl();
    if (!callback?.startsWith("https://")) throw new TwilioOnboardingError("PLATFORM_NOT_CONFIGURED");
    return this.parseSender(await this.request(SENDERS, this.subaccount(account), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender_id: "whatsapp:" + phone, configuration: { waba_id: wabaId },
        webhook: { callback_url: callback, callback_method: "POST" } }),
    }));
  }
  async getSender(account: TwilioAccount, sid: string) {
    if (!senderPattern.test(sid)) throw new TwilioOnboardingError("TWILIO_SENDER_REVIEW_REQUIRED");
    return this.parseSender(await this.request(SENDERS + "/" + sid, this.subaccount(account)));
  }
  async verifySender(account: TwilioAccount, sid: string, code: string) {
    if (!senderPattern.test(sid)) throw new TwilioOnboardingError("TWILIO_SENDER_REVIEW_REQUIRED");
    return this.parseSender(await this.request(SENDERS + "/" + sid, this.subaccount(account), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configuration: { verification_code: code } }),
    }));
  }
}
