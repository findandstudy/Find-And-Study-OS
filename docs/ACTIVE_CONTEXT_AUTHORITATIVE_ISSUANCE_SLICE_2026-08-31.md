# Active-context authoritative issuance slice - 31 August 2026

This default-unwired slice adds the pure authoritative issuance coordinator
used by later PostgreSQL resolver adapters.

- Live-first base: `0264e6f4`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Source and direct-test Git blobs: `2/2` exact.
- Authoritative issuance tests: `5/5`.
- API typecheck: pass.

Membership, assignment, policy, context ID and time bounds come only from the
locked server repository state. Client injection, branded-scope drift,
inactive/malformed state, timeout and revoke races fail closed.

No PostgreSQL repository, route, session gateway, worker, publisher or
production wiring is included. GitHub push/PR/merge, `Next` synchronization and
deployment have not occurred.
