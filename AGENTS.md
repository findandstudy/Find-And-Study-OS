# Find And Study OS — Production Safety Instructions

These instructions apply to every task performed in this repository.

## Primary safety objective

Production remains active while development continues. Students, applications,
documents, messages, payments, notifications, and uploaded files may be created
or changed at any time. Preserve all production data added after the local
snapshot was taken.

The local database and local storage are disposable development copies. They
must never be treated as the current source of truth for production data.

## Hard rules

- Never restore the local database or a local dump into production.
- Never synchronize local database rows back to production.
- Never replace production storage with the local storage directory.
- Never copy a local `.env` file to production.
- Never commit or push dumps, `.env` files, credentials, tokens, logs containing
  secrets, or copied production storage.
- Never run a production migration, destructive SQL statement, deployment,
  service restart, container restart, or worker restart without explicit user
  approval for that specific production action.
- Never assume GitHub matches the code currently running on the VPS. Verify the
  production commit and production worktree before planning a deployment.
- Treat all production access as read-only unless the user has explicitly
  approved a defined deployment step.

## Allowed data direction

Production data may be copied to an isolated local environment for development:

```text
Production database/storage -> Local development copy
```

Do not reverse that direction. Production receives application code and vetted
schema migrations, not local database contents or local storage snapshots.

## Database migration requirements

Before proposing a production migration:

1. Inspect the current production schema read-only.
2. Test the migration against a recent production-derived local copy.
3. Estimate locks, runtime, disk growth, and impact on active requests/workers.
4. Prefer additive and backward-compatible changes:
   - add tables;
   - add nullable columns;
   - add indexes using a production-safe method;
   - deploy code that tolerates both old and new schema states;
   - backfill separately in bounded batches when required.
5. Do not drop, truncate, rename, rewrite, or change the type of populated
   production columns without a dedicated plan and explicit approval.
6. Do not use ORM schema push/sync commands against production.
7. Review the generated SQL rather than trusting migration generation alone.

Destructive or irreversible SQL requires a fresh backup, a rollback/data
recovery plan, and explicit user confirmation immediately before execution.

## Required production deployment gate

Do not deploy until all of the following have been reported to the user:

- exact source commit and files included in the release;
- production commit and dirty-worktree status;
- migration SQL and whether it changes or locks existing data;
- current database and storage backup plan;
- expected downtime or confirmation of a backward-compatible rollout;
- worker, queue, cron, email, messaging, and portal-automation impact;
- health checks and smoke tests to run after deployment;
- code rollback plan and database recovery limitations.

Wait for explicit approval after presenting this preflight report.

## Backup policy

Immediately before an approved production release that can affect data:

- create a fresh PostgreSQL custom-format dump with `--no-owner --no-acl`;
- verify the dump exit code, SHA-256 checksum, and `pg_restore --list` output;
- capture or verify a recoverable production storage backup/snapshot;
- record the production Git commit and deployment timestamp;
- keep backups outside Git and do not expose credentials in output.

A database restore is a last resort because restoring an older snapshot can
delete valid activity that occurred after the snapshot. Prefer rolling back code
while keeping a backward-compatible database schema whenever possible.

## Workers and external integrations

Production background jobs can change data or contact real users. Deployment
planning must explicitly cover email queues, notifications, messaging,
WhatsApp/Meta integrations, portal automation, scheduled jobs, and cron tasks.

- Avoid running two incompatible worker versions concurrently.
- Require idempotency or a single-consumer transition plan.
- Do not test live integrations using production recipients.
- Keep live integrations disabled in local development.

## Local development safeguards

- Use only the local PostgreSQL endpoint on `127.0.0.1:5433` and database
  `fasos_apply_local` unless the user explicitly changes the local setup.
- Keep `ALLOW_LIVE_INTEGRATIONS=false` locally.
- Treat local startup migrations, seeders, and background workers as capable of
  modifying the local copy.
- Confirm the resolved database host before running scripts that mutate data.
- Do not use the quarantined `fasos_apply-production.unverified.dump`.

## Stop conditions

Stop and ask the user before proceeding when:

- the target database or server cannot be proven to be local;
- a command could overwrite or delete production data or storage;
- a migration is not backward compatible;
- the production worktree contains unexplained changes;
- the backup cannot be verified;
- rollback would require restoring an old database snapshot;
- a deploy could cause external messages, payments, or portal submissions;
- required secrets, ownership, target paths, or release scope are ambiguous.

When uncertain, preserve production state and present the uncertainty rather
than making an assumption.

## 2 Eylül 2026 — Institution Admissions v1 yerel eki

`codex/institution-admissions-v1-20260902` branch'inde ayrı `/institution`
portal shell'i, altı kurum rol paketi, review/evidence/information-request,
versioned decision + maker-checker, offer/enrolment, requirements, SLA,
PII-minimized analytics, team ve secret-reference-only integrations yüzeyi
uygulandı. Additive `0083_institution_admissions_foundation.sql` ile 13
tenant/relationship-owned ve FORCE-RLS tablo eklendi; kanonik ledger `84/84`.
Program/intake değişikliği legacy kataloğa doğrudan yazılmaz; internal ChangeSet
bekleyen append-only talep üretir.

Feature default-off'tur. Production'da ayrı non-super/non-BYPASSRLS
`fas_institution_executor` bağlantısı zorunludur. Yüksek etkili komutların local
assurance bayrağı production'da etkisizdir. Production, staging, `Next`, dış
iletişim ve portal automation wiring'i bu çalışma sırasında değiştirilmedi.
Fresh PostgreSQL migration, pure contract `7/7`, PostgreSQL security `6/6`, DB/
API/Edcons typecheck ve iki production build PASS'tir. Canlı adoption,
Control Plane provisioning, active-context/step-up, Privacy/Legal, consentli
cohort ve bağımsız review ayrı NO-GO kapılarıdır. Ayrıntı:
`INSTITUTION_ADMISSIONS_V1_IMPLEMENTATION_2026-09-02.md`.

### 2 Eylül 2026 — Institution authority hardening eki

Yukarıdaki `84/84`, `7/7` ve `6/6` yerel kanıtını supersede eder. Additive
`0084_institution_admissions_authority_hardening.sql` ile kanonik ledger
`85/85` oldu. Relationship purpose/data-scope, program/intake/assigned-reviewer
kapsamı, current membership actor bağı, kurum rol ayrımı, evidence lineage ve
decision/offer/enrolment receipt-evidence corridor'u PostgreSQL RLS/trigger
sınırında fail-closed hale getirildi. Institution Admin application reviewer
değildir; Auditor masked/read-only kalır; decision maker ile checker aynı olamaz.
Bilgi isteği update corridor'u bu dilimde DB seviyesinde kapalıdır.

Yeni ayrı `/institution/audit` yüzeyi PII-free masked append-only projection'dır.
Dedicated Institution CI workflow'u Linux/Windows/PostgreSQL 16 kapılarını,
genel convergence workflow'u da pure ve PostgreSQL institution regresyonlarını
çalıştırır. Fresh `85/85`, clean replay, pure `9/9`, exact least-privilege
executor PostgreSQL `10/10`, migration authority `29 PASS + 1` Bash-unavailable
SKIP, tenant-writer ve legacy-route inventory, full workspace typecheck, 10 dil
i18n, API/Edcons production build, data-boundary `4/4`, integration DB safety
`11/11` ve live security regression `31/31` PASS'tir. Production, staging,
`Next`, gerçek PII, external send/portal automation, merge ve deploy
değiştirilmemiştir; bunlar ayrı onay ve NO-GO kapılarında kalır.

Institution v1 code-bearing head'i
`0461c88f9d7fdf02ace2063b1b3d6c1fa0a68c30`, tree'si
`f26b88e59715d6f70bb5101fd120d0c28ea55166` ve base
`822112fb471ad53365034b9b928b5510b4c06d81` → code binary-patch SHA-256 değeri
`f5ac4f4b85fbdad148b5f813081b2259734ebbc6339e206ec0aada510e97f182` olarak
`INSTITUTION_ADMISSIONS_V1_REVIEW_PACKET_2026-09-02.md` içinde donduruldu.
Review packet commit'i code-bearing değildir; bağımsız reviewer exact final
branch HEAD'ini ayrıca kabul etmelidir.

### 2 Eylül 2026 — Institution active-context/step-up eki

Yukarıdaki Institution code/review kimliği ve `85/85`, PostgreSQL `10/10`
kanıtını supersede eder. Local-assurance escape hatch'i kaldırıldı. Karar
approve/return/reject, offer issue, enrolment transition ve requirement publish
komutları artık yalnız Ed25519 v2 signed active-context, exact current
selection/session generation, server-derived session fingerprint, HUMAN
principal, external `admissions.review` relationship, current policy/data-scope,
tek kullanımlık exact step-up ve mevcut domain maker-checker/evidence sınırları
birlikte geçerse çalışır; API token ve impersonation daima reddedilir.

Additive `0085_institution_active_context_step_up.sql` ile dört tablo eklenmiş,
Institution FORCE-RLS toplamı `17`, kanonik ledger `86/86` olmuştur. PII-free
authorization receipt insert'i current selection, relationship, membership,
tenant, principal, role package, capability ve policy satırlarını transaction
sonuna kadar `FOR SHARE` ile kilitler. Lock-only FORCE-RLS policy'leri
`WITH CHECK(false)` kullanır; exact `fas_institution_executor` selection,
relationship veya membership UPDATE privilege'ına sahip değildir. Direct team
grant kapatılmış, yalnız `PENDING_CONTROL_PLANE` membership request; direct SLA
activation/retire kapatılmış, yalnız authorization-bound `DRAFT` üretilmiştir.

Institution code-bearing head `b117e71a013e57efe5e9ce67f777c6b2fe39472f`,
tree `782daa3c4166e7db074bbb2f983562863e2edd8f`, base
`822112fb471ad53365034b9b928b5510b4c06d81` → code binary-patch SHA-256
`4400a1164d4647f9b244ab3ae9cb15145697c9c3ffce2abf3d396b432dbfe329`
ve byte uzunluğu `438510` olarak review packet'te dondurulmuştur. Base→code
farkı `4 commit / 46 dosya / 7.507 ekleme / 31 silme`dir. Fresh PostgreSQL
16.15 `86/86` + clean replay, pure contract `9/9`, pure authorization `9/9`,
exact least-privilege PostgreSQL `12/12`, migration authority `29 PASS + 1`
Bash-unavailable SKIP, tenant writer `166/166` ve `2.222` surface, legacy route
`72/794`, full workspace typecheck, 10 dil i18n, API/Edcons builds,
data-boundary `4/4`, integration DB safety `11/11` ve security regression
`31/31` PASS'tir.

Active-context selection issuer, MFA step-up issuer, Ed25519 key-ring, Control
Plane request apply, staging migration/UAT ve bağımsız review henüz yapılmadı.
Production, staging, `Next`, gerçek PII, dış mesaj/SIS/portal execution,
push/merge/deploy değiştirilmemiştir ve ayrı açık onay gerektirir.

### 2 Eylül 2026 — Institution case-intake eki

Yukarıdaki `86/86` kanıtını supersede eder. Additive
`0086_institution_case_intake_receipts.sql` ile kanonik ledger `87/87`,
Institution FORCE-RLS toplamı `18` olmuştur. Varsayılan kapalı intake adapter'ı
yalnız başarılı gerçek portal submission'ı; current tenant→legacy branch,
application/student, external `admissions.review` relationship/institution,
program ve portal-university mapping bağları aynı transaction'da geçerse kurum
review queue'sunda case'e dönüştürür. Case `shared_profile={}` ve deterministik
maskeli öğrenci referansı taşır; ham external reference, result JSON,
screenshot, iletişim/kimlik veya belge içeriği projection'a girmez.

Source snapshot, external reference, command ve receipt SHA-256 ile dondurulur;
`institution_case_intake_receipts` append-only, case source bağı immutable ve
aynı submission idempotent/concurrency-safe'tir. Exact
`fas_institution_intake_executor` hiçbir Institution tablosunda SELECT/INSERT
yetkisine sahip değildir; yalnız ayrı NOLOGIN/non-super/non-BYPASSRLS owner'lı,
`row_security=on` SECURITY DEFINER fonksiyonunu çalıştırır. Feature modu
`off|allowlist|all` olup varsayılan `off`tur; route/worker wiring, backfill,
staging/production activation, dış portal çağrısı ve gerçek PII yoktur.

Fresh PostgreSQL 16.15 `87/87` + clean replay, pure Institution contract
`10/10`, authorization `9/9`, intake `4/4`, Institution PostgreSQL `12/12`,
intake PostgreSQL `5/5`, migration authority `30 PASS + 1` Bash-unavailable
SKIP, tenant writer `167/167` ve `2.226` surface, legacy route `72/794`, full
workspace typecheck, 10 dil i18n, API/Edcons production builds, data-boundary
`4/4`, integration DB safety `11/11` ve security regression `31/31` PASS'tir.
Production-prefix `66→87` harness'i CI'da bağlanmıştır; bu dilimde mevcut yerel
`fasos_apply_local` DB'si korunmuş ve yeniden oluşturulmamıştır. Bağımsız review,
staging adoption/rollback, dedicated owner/executor provisioning, consentli
allowlist job wiring ve Privacy/Legal hâlâ NO-GO kapılarıdır.

Institution case-intake dahil güncel code-bearing head
`6cb9dd3e2d7f33644c4b98d948d6a91fc02791e4`, tree
`82e52312f660c56fc5ad11871e0e4086388b4bc4`, base
`822112fb471ad53365034b9b928b5510b4c06d81` → code farkı
`6 commit / 51 dosya / 8.922 ekleme / 31 silme`, binary-patch SHA-256
`7812ea20a9c670ac6b3b0c86c19061c8710c04f5c7a9d1020d7cac8e1d1fe2f3`
ve byte uzunluğu `512541` olarak review packet'te dondurulmuştur. Review packet
commit'i code-bearing değildir; bağımsız reviewer exact final branch HEAD'ini
ayrıca kabul etmelidir.

### 2 Eylül 2026 — Institution consent-bound evidence eki

Yukarıdaki Institution case-intake code/review kimliği ve `87/87` kanıtını
supersede eder. Additive `0087_institution_evidence_share_receipts.sql` ile
kanonik ledger `88/88`, Institution FORCE-RLS toplamı `19` olmuştur. Kurum
reviewer'ı artık serbest evidence hash giremez; yalnız exact institution case'e,
Journey verified evidence/requirement sonucuna ve en son aktif
`institution.admissions.evidence_share` in-app consent receipt'ine bağlı,
PII-minimized manifesti seçebilir. Ham document byte veya private object ref
kurum projection'ına girmez.

Share receipt append-only'dir. Idempotent replay current relationship,
verified-evidence ve consent durumunu yeniden doğrular; consent withdrawal eski
receipt replay'ini ve yeni assessment'i reddeder. Assessment DB timestamp'i,
current reviewer membership'i ve program/intake/case scope'u PostgreSQL
trigger/RLS sınırında tekrar doğrulanır. Exact
`fas_institution_evidence_share_executor` tablo yetkisiz/EXECUTE-only; fonksiyon
owner'ı NOLOGIN/non-super/non-BYPASSRLS'tir. Feature `off|allowlist|all`,
varsayılan `off`; adapter default-unwired'dır ve consent, dış gönderim veya
belge aktarımı üretmez.

Güncel code-bearing head `efb8d10e948db878857421be3b9f1b45a77bc8f8`,
tree `e2d0af4a2ee65167937b1e5146311151272c50e0`, base
`822112fb471ad53365034b9b928b5510b4c06d81` → code farkı
`8 commit / 56 dosya / 10.595 ekleme / 31 silme`, binary-patch SHA-256
`a8a2b16a923247bffb0b250287fb3ccc4f904202d4086f163bd4645921be2d5e`
ve byte uzunluğu `589418` olarak review packet'te dondurulmuştur.

Fresh PostgreSQL 16.15 `88/88` + clean replay, pure Institution contract
`11/11`, authorization `9/9`, intake `4/4`, evidence-share `4/4`, Institution
PostgreSQL `12/12`, intake PostgreSQL `5/5`, evidence-share PostgreSQL `7/7`,
migration authority `31 PASS + 1` Bash-unavailable SKIP, tenant writer `168/168`
ve `2.231` surface, legacy route `72/794`, full workspace typecheck, 10 dil
i18n, API/Edcons production builds, data-boundary `4/4`, integration DB safety
`11/11` ve security regression `31/31` PASS'tir.

Production, staging, `Next`, GitHub remote, gerçek PII, consent creation,
worker/route wiring, dış mesaj/SIS/portal execution, merge ve deploy
değiştirilmemiştir. Bağımsız review, staging `0083–0087` adoption/rollback,
dedicated owner/executor provisioning, active-context/MFA issuer'ları,
Privacy/Legal ve consentli staging allowlist UAT ayrı NO-GO kapılarıdır.
