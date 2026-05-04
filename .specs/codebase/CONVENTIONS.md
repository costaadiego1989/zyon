# Conventions

- Use TypeScript strict mode.
- Use NestJS only in `presentation` and module wiring.
- Keep DTO shape compatible with `@aacp/shared-types`.
- Name use cases as `VerbNounUseCase`.
- Keep domain methods deterministic and side-effect free unless they emit explicit events.
- Persist and query everything by `merchant_id` first.
- Treat `global_user_id` as a stable buyer identity, never as permission to mix merchant data.
- Keep packages in `packages/*` free of framework imports.
- Treat commerce providers and payment providers as separate adapter families.
- Never expose payment provider secrets, commerce tokens, raw card data, CVV, margin, cost, or merchant policy through the browser embed.
- Browser-supplied cart totals are not authoritative in production embed flows; trusted cart/order values must be resolved server-side.
