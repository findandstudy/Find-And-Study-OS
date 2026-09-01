# Live-first convergence independent-review packet — 1 September 2026

## Purpose and status

This packet makes the large convergence pull request reproducible and
reviewable without claiming that an independent review has occurred. It pins
the exact production-derived base and every code-bearing change through the
last locally safe foundation commit. A verifier reconstructs the Git patch,
tree, aggregate counts and review groups in CI.

This is evidence for review, not merge approval. PR #30 remains draft. No
reviewer or team has been requested, no review has been submitted, and no
branch ruleset protects the live base. Production/VPS mutation, merge, deploy,
`Find-And-Study-OS-Next` synchronization and live feature activation remain
NO-GO.

## Frozen review identity

| Fact | Frozen value |
|---|---|
| Base branch | `hotfix/embed-release-20260830` |
| Base commit | `6dca1f951590dce297bb4d3579bd17d8d9f92e5f` |
| Reviewed-through commit | `cf22635609f3537b22a2f41c677b5a3c7fba8802` |
| Reviewed tree | `99ce24343bf0112d79aae41a899ec9be31ef5993` |
| Canonical binary-patch SHA-256 | `1a8316bd5a8af111ae67e2c4107abf5c407a1d4b6bfa8afa66d66b672569e929` |
| Commit count | `60` |
| Changed files | `181` |
| Insertions / deletions | `52,266 / 290` |

The reviewed base is the public-health-attested live branch source commit, not
the stale `Find-And-Study-OS-Next/main` snapshot. The reviewed-through commit is
the last code-bearing head before this review infrastructure. Any later source
head must descend from it and may change only the six review-infrastructure
paths frozen in `security/convergence-review-manifest.json`. A source/runtime,
migration, route, UI, dependency or deploy change after that commit fails the
unchanged CI verifier.

## Review denominator

The 181 reviewed files reconcile exactly into these mutually exclusive groups:

| Review group | Files | Primary question |
|---|---:|---|
| Migration/data authority | 27 | Does `0000–0065` remain byte-authoritative and can `0066–0081` be adopted only on an explicitly approved database? |
| Deployment/attestation | 13 | Are root, ownership, disk, process, release and read-only production probes fail-closed and side-effect-free? |
| Student Journey | 21 | Are self-scope, next action, evidence, response, evaluation and gate claims separated correctly? |
| Control Plane/authorization | 58 | Are tenant/context/session/capability/receipt/ChangeSet boundaries transactional and default-unwired? |
| Live API boundary | 13 | Do changes to existing routes/configuration preserve live behavior while closing privilege or external-send gaps? |
| Frontend | 12 | Are permission projection and Student Journey UI changes scoped, accessible and default-off? |
| Security inventory | 4 | Do writer/route denominators remain complete and quarantined? |
| CI/supply chain | 8 | Are actions, pnpm, lock graph and integration safety pinned and non-secret-bearing? |
| Other tests | 16 | Do live regressions and negative boundaries cover the modified legacy surfaces? |
| Documentation | 9 | Do adoption claims match executable evidence and retain NO-GO boundaries? |
| Unclassified | 0 | Must remain zero. |

## Required review order

Review should proceed in dependency order; later slices cannot make an earlier
failed boundary acceptable.

1. **Base and migration authority:** confirm the base commit, production prefix,
   migration hashes/journal and fresh plus `66→82` disposable adoption.
2. **Deployment and production attestation:** inspect every read/write API,
   subprocess boundary, `/proc` identity check, filesystem budget and explicit
   opt-in. Confirm no automatic retention/delete path exists.
3. **Authorization and Control Plane schema:** inspect tenant composite keys,
   RLS/role assumptions, immutable receipts, idempotency, evidence binding and
   selection/session lifecycle.
4. **Authorization orchestration and PostgreSQL adapters:** inspect revoke,
   retry, ambiguous commit, cancellation, connection cleanup and repair paths.
5. **Existing live API boundary:** inspect the following 13 files line by line;
   these are changes to pre-existing runtime behavior rather than isolated
   foundations:
   - `artifacts/api-server/src/lib/clientIp.ts`
   - `artifacts/api-server/src/lib/consentCommunicationContract.ts`
   - `artifacts/api-server/src/lib/inbox/aiAgentConfig.ts`
   - `artifacts/api-server/src/lib/inbox/botAutoReply.ts`
   - `artifacts/api-server/src/lib/inbox/dormBookingFollowupWorker.ts`
   - `artifacts/api-server/src/routes/agents.ts`
   - `artifacts/api-server/src/routes/ai-extract.ts`
   - `artifacts/api-server/src/routes/aiBots.ts`
   - `artifacts/api-server/src/routes/branches.ts`
   - `artifacts/api-server/src/routes/inbox.ts`
   - `artifacts/api-server/src/routes/roles.ts`
   - `artifacts/api-server/src/routes/settings.ts`
   - `artifacts/api-server/src/routes/users.ts`
6. **Student Journey and frontend:** confirm which code is default-off runtime,
   which is default-unwired foundation, and that no foundation can manufacture
   verified evidence, fulfilment, consent, QAVJP or a gate decision.
7. **Security inventories, tests and CI:** verify that the normal denominators
   remain frozen, strict G30 remains NO-GO, credentials are not persisted and
   live integrations remain disabled.
8. **Claims and exclusions:** compare documentation to code and record a signed
   review outcome without converting CI success into production readiness.

## Independent-review acceptance record

The independent reviewer must record all of the following outside the authoring
agent's self-review:

- reviewer identity/team and review time;
- exact base, reviewed-through commit, tree and patch SHA-256 above;
- findings by review group, with severity and disposition;
- explicit confirmation that production `0066+` adoption, non-root runtime,
  disk retention, SSH changes, live Journey wiring and external communication
  are excluded;
- approval, changes requested, or rejection;
- the exact final source head accepted after review-infrastructure-only changes.

Approval is invalid if the manifest verifier reports drift, if any group is
unclassified, if a post-review code path appears, if the PR event target branch
or commit differs from the frozen base identity, or if the reviewer reviewed a
different base/tree/patch.

The verifier, manifest and workflow are source-controlled review aids, not an
external trust root. A later edit to any of them requires renewed human review
and a newly pinned final source head. Repository branch protection and required
independent approval remain necessary to prevent an author from weakening the
check in a subsequent commit.

The manifest separately pins the exact Git blob identity of every allowed
post-review infrastructure file except the manifest itself: the workflow,
package script, verifier, verifier tests and this review packet. The manifest
cannot cryptographically pin its own blob without a circular identity. A change
to any pinned file therefore requires both refreshed blob evidence and renewed
human review of the manifest change; the manifest remains non-authoritative
until an external reviewer accepts the exact final source head.

## Mechanical verification

Run from a full-history checkout:

```text
pnpm run test:convergence-review
```

The command:

1. resolves the exact base and reviewed-through commits;
2. requires the base to be their merge base;
3. reconstructs and hashes the canonical Git binary patch;
4. verifies commit/file/insertion/deletion and group denominators;
5. requires zero unclassified files;
6. requires the current source head to descend from the reviewed-through
   commit;
7. rejects every post-review path outside the frozen review-infrastructure
   allowlist;
8. requires the actual PR event target-base branch and commit to equal the
   frozen review base identity and rejects a missing assertion in CI;
9. resolves every non-manifest post-review infrastructure path at the exact
   source head, requires an ordinary Git blob and compares its identity against
   the manifest's complete pinned-path denominator.

The Linux exact-head CI checkout uses full history and supplies the actual PR
source head rather than the synthetic merge commit, together with the actual PR
target-base ref and SHA. A manual workflow run falls back only to the same
frozen base identity. Clean-worktree and mandatory target-base enforcement are
enabled in CI. This verifier does not request a review, merge a PR, deploy a
release or inspect production.
