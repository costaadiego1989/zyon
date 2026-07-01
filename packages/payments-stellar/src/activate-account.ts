import {
  Keypair,
  Asset,
  Networks,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Horizon } from "@stellar/stellar-sdk";

export const CIRCLE_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const USDC_ASSET = new Asset("USDC", CIRCLE_USDC_ISSUER);
const HORIZON_URL = "https://horizon.stellar.org";

export interface ActivateAccountOptions {
  merchantPublicKey: string;
  merchantSecretKey: string;  // needed to sign changeTrust + endSponsoring on merchant's behalf
  platformSecretKey: string;  // STELLAR_PLATFORM_SECRET env var
}

export async function activateMerchantStellarAccount(opts: ActivateAccountOptions): Promise<void> {
  const { merchantPublicKey, merchantSecretKey, platformSecretKey } = opts;
  const horizon = new Horizon.Server(HORIZON_URL);

  const platformKp = Keypair.fromSecret(platformSecretKey);
  const merchantKp = Keypair.fromSecret(merchantSecretKey);

  const platformAccount = await horizon.loadAccount(platformKp.publicKey());

  const tx = new TransactionBuilder(platformAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC,
  })
    // 1. Create merchant account with 2 XLM starting balance
    .addOperation(
      Operation.createAccount({
        destination: merchantPublicKey,
        startingBalance: "2",
      })
    )
    // 2. Platform sponsors future reserves for merchant (covers USDC trustline reserve)
    .addOperation(
      Operation.beginSponsoringFutureReserves({
        sponsoredId: merchantPublicKey,
      })
    )
    // 3. Merchant creates USDC trustline (reserve sponsored by platform)
    .addOperation(
      Operation.changeTrust({
        asset: USDC_ASSET,
        source: merchantPublicKey,
      })
    )
    // 4. End sponsorship (merchant's account signs this)
    .addOperation(
      Operation.endSponsoringFutureReserves({
        source: merchantPublicKey,
      })
    )
    .setTimeout(30)
    .build();

  // Both platform and merchant must sign
  tx.sign(platformKp, merchantKp);

  await horizon.submitTransaction(tx);
}
