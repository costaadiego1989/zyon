import { Injectable } from "@nestjs/common";
import type { TikTokShopOAuthPort } from "../../domain/ports/tiktokshop-oauth.port.js";
import { exchangeTikTokShopCode, getTikTokShopIdentity, tiktokShopAuthorizationUrl } from "./tiktokshop-api.js";

@Injectable()
export class TikTokShopOAuthAdapter implements TikTokShopOAuthPort {
  authorizationUrl(state: string) { return tiktokShopAuthorizationUrl(state); }
  exchangeCode(code: string) { return exchangeTikTokShopCode(code); }
  getShopIdentity(accessToken: string, selectedShopId?: string) { return getTikTokShopIdentity(accessToken, selectedShopId); }
}
