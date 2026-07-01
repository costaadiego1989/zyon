import { Keypair } from "@stellar/stellar-sdk";

export interface StellarAccountInit {
  publicKey: string;   // G... address — store in DB
  secretKey: string;   // S... secret — show ONCE, never persist
}

export function generateStellarKeypair(): StellarAccountInit {
  const kp = Keypair.random();
  return {
    publicKey: kp.publicKey(),
    secretKey: kp.secret(),
  };
}
