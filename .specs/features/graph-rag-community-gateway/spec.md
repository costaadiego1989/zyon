# Private Community query service

**Approved**: 2026-11-03 - user: "Community com serviço privado de consultas controladas, sem licença Enterprise (recomendado)"

The user selected the Community architecture after being told that Community cannot satisfy the original direct-driver reader-role gate. This phase adds an isolated authenticated query surface; it does not represent its database account as a database-enforced reader. Direct-driver mode retains its actual reader-role requirement.

## Goals

- Enable the existing GraphRAG implementation for Athom through a private Railway service, without accepting an Enterprise license.
- Expose typed bounded read operations with fixed Cypher templates, no generic query or projection endpoint.
- Keep canonical revalidation, public PostgreSQL fallback, transaction authority and explicit cart consent.

## Out of Scope

New purchases, financial events, inventory mutations, labels/physical dispatch, private buyer data in the graph, arbitrary Cypher, a public gateway domain, new Enterprise subscriptions and cross-merchant search.

## Assumptions & Open Questions

**Open questions:** none for implementation. Existing user authorization covers private service provisioning, production release and owned test conversations. Production activation follows the concrete proofs below.

## User Stories

### P1: Private bounded query execution

**Acceptance Criteria**:

1. WHEN the service receives a query THEN it SHALL verify an HMAC over method, path, timestamp, nonce and the exact bounded body before executing a fixed read template. Invalid signatures, stale timestamps, nonce reuse, unknown operations, unlisted tenants and unknown fields SHALL cause zero graph reads. (GW-01)
2. WHILE Community mode is selected the query service SHALL expose no Cypher-text, projection, schema or commercial-write operation; every graph traversal SHALL retain merchant scope and bounded rows/transactions. (GW-02)
3. WHEN the API admits the query service THEN it SHALL verify a signed response bound to its nonce and the expected protocol/template hash; an invalid admission or response SHALL preserve canonical fallback and perform no synthetic embedding or commercial write. (GW-03)

**Independent Test**: Exercise a real HTTP server with valid, tampered, replayed and foreign requests; use a graph spy to observe exact zero reads on rejected cases.

### P1: Production integration

**Acceptance Criteria**:

4. WHEN Community mode is enabled for Athom THEN the API SHALL use the private query port for reads and a distinct projection identity for graph synchronization, and revalidate graph results against canonical public sources/current variants. (GW-04)
5. WHILE disabled, unlisted, unavailable or shutting down the integration SHALL preserve its zero-network/default-off and bounded fallback/lifecycle behavior. (GW-05)
6. BEFORE production activation the operator SHALL prove the private deployment revision, health, authentication, actual Neo4j template reads, real multilingual inference, current canonical projection and shared-channel results; failures SHALL remain reported distinctly from local tests. (GW-06)

**Independent Test**: Real local Neo4j plus HTTP transport and signed client; then Railway private service/API runtime proof and owned WhatsApp/storefront reads after the actual source is served.

## Edge Cases

- Client timestamps never widen source freshness; the gateway applies its server clock and maximum freshness.
- Signatures bind HTTP status and body on the response, and redirects are refused.
- Body, replay cache, concurrency, model, candidate and timeout bounds remain finite.
- The query process receives no PostgreSQL credentials, buyer identity, payment key or projection endpoint.
- A secret never appears in CLI arguments, committed files, tool output or request logs.
- Model weights are cached and real inference is checked during API image build before the first shopper request.

## Requirement Traceability

| Requirement ID | Phase | Status |
| --- | --- | --- |
| GW-01 | T1 | Verified |
| GW-02 | T1 | Verified |
| GW-03 | T2 | Verified |
| GW-04 | T2/T3 | T2 verified; production pending |
| GW-05 | T2 | Verified |
| GW-06 | T3 | In Tasks |

## Differences from the source

- Original GraphRAG direct-driver admission requires an actual reader role. Community mode instead places typed fixed reads behind a separate private authenticated service. Its Community database account is implicitly administrative; the service surface supplies the compensating restriction. **Confirmed: y**, user chose this architecture in the explicit answer above. The original direct-driver guard is preserved.
