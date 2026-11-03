# Community query service design

The API owns inference, canonical public-source revalidation and derived graph synchronization. A separate small Railway process owns a single typed read surface and a distinct Community database identity. PostgreSQL remains authoritative. The gateway receives no commercial database/payment credentials.

The request protocol signs method, exact path, time, random nonce and body hash with a service secret. Response authentication binds the request nonce, status and body hash. Both peers enforce the template fingerprint. Replay, body size, concurrency and time budgets are bounded; only the allowlisted merchant and pinned model are admitted. Production URLs are private Railway endpoints, redirects and URI credentials are refused.

The gateway reuses the compiler and result schemas. Its deployment artifact contains no projection code or generic Cypher endpoint. A capability admission is distinct from database role admission: Community is never described as providing a reader role. Direct Neo4j mode keeps that original check.

Projection uses a separate database identity. Every proposed candidate is reread through canonical public-source ports and the existing same-variant commercial SQL. Existing graph failure/public PostgreSQL fallback and terminal shutdown behavior remain.

Deployment order: local HTTP/security tests and real graph transport; private service and scoped credentials; signed runtime admission; pinned API build with both model caches; allowlist Athom; verify actual served source, projection, public search and owned-channel behavior. Do not create another payment or mutate the paid QA order.
