# Zyon Payment Splitter

Atomic ERC-20 payment splitter for crypto checkout.

## How it works

1. Buyer approves USDC/USDT spend to the splitter contract
2. Buyer (or API relayer) calls `pay(token, merchant, amount, orderId)`
3. Contract splits atomically: merchant receives `amount - fee`, Zyon treasury receives `fee`
4. `PaymentProcessed` event emitted for off-chain indexing

## Deployment

| Chain | Token | Address |
|-------|-------|---------|
| Polygon PoS | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Polygon PoS | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Base | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Constructor args

```
_treasury:      Zyon treasury wallet (receives fees)
_initialFeeBps: 300 (3%)
_tokens:        [USDC_ADDRESS, USDT_ADDRESS]
```

## Deploy script (Hardhat)

```bash
npx hardhat run scripts/deploy.ts --network polygon
```

## Gas costs

| Operation | Gas | Cost (Polygon) |
|-----------|-----|----------------|
| Deploy | ~800k | ~$0.02 |
| pay() | ~65k | ~$0.003 |

## Security

- `ReentrancyGuard` — prevents re-entrancy on token callbacks
- `SafeERC20` — handles non-standard token return values
- `Ownable` — only owner can adjust fee or token whitelist
- `MAX_FEE_BPS = 1000` — hard cap at 10%, immutable in bytecode
- `immutable treasury` — cannot be changed post-deploy
- No custodial risk — funds go directly from buyer to merchant/treasury

## Fee adjustment

Owner can call `setFee(newBps)` — capped at 1000 (10%). Emits `FeeUpdated` event.

## Integration with Zyon API

The API creates a payment intent → returns contract address + token + amount.
Widget prompts buyer to approve + call `pay()`.
API watches `PaymentProcessed` events via RPC to confirm payment.
