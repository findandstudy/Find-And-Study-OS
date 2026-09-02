# Institution Admissions v1 — Yerel Uygulama Kaydı

Tarih: 2 Eylül 2026
Branch: `codex/institution-admissions-v1-20260902`
Durum: Yerel uygulama, authority hardening ve disposable PostgreSQL kanıtı tamamlandı; production, staging, `Next`, dış iletişim ve portal automation wiring'i değiştirilmedi.

## Teslim edilen ürün yüzeyi

- Ayrı `/institution` portal shell'i.
- Kurum bağlamına göre capability tabanlı menü ve route projection'ı.
- Home, review queue, applications, application review, decisions, offers,
  programs/intakes, requirements, SLA, integrations, analytics ve team ekranları.
- Altı sürümlü kurum rol paketi:
  - Institution Admin
  - Program / Intake Manager
  - Admissions Reviewer
  - Decision Approver
  - Integration Admin
  - Institution Auditor
- Evidence assessment, information request, evidence-bound
  `READY_FOR_DECISION`, karar taslağı, bağımsız maker-checker onayı, offer
  issuance ve enrolment confirmation komutları.
- Requirement set draft/review/publish ve bağımsız checker sınırı.
- SLA versioning ve PII-minimized aggregate analytics.
- PII içermeyen, append-only hash zincirini gösteren ayrı masked audit ekranı.
- Program/intake değişiklikleri legacy katalogda doğrudan yazılmaz; append-only
  `PENDING_INTERNAL_CHANGESET` talebi üretir.
- Integration ekranı secret-reference-only projection döndürür; ham credential
  ve dış execution yoktur.

## Veri ve güvenlik omurgası

`0083_institution_admissions_foundation.sql` migration'ı 13 yeni tablo ekler:

1. `institution_relationships`
2. `institution_memberships`
3. `institution_sla_policies`
4. `institution_application_cases`
5. `institution_requirement_sets`
6. `institution_requirements`
7. `institution_evidence_assessments`
8. `institution_information_requests`
9. `institution_decisions`
10. `institution_decision_approvals`
11. `institution_offers`
12. `institution_enrolments`
13. `institution_admission_events`

Tüm tablolar tenant + institution relationship sınırındadır, `FORCE RLS`
kullanır ve DELETE policy içermez. Evidence, approval ve event geçmişi
append-only'dir. Case, decision, offer, enrolment ve requirement state
transition'ları PostgreSQL trigger'larıyla da doğrulanır.

Additive `0084_institution_admissions_authority_hardening.sql` ise:

- program, intake ve atanmış reviewer kapsamını RLS sınırına taşır;
- INSERT/UPDATE actor alanlarını geçerli membership ve kurum rolüne bağlar;
- admin, reviewer, approver, manager ve auditor görev ayrımını DB'de uygular;
- evidence supersession lineage'ını ve requirement/case eşleşmesini doğrular;
- decision transition'ını bağımsız checker approval receipt'ine bağlar;
- `DECIDED`, `OFFER_ISSUED`, `ENROLMENT_PENDING` ve `ENROLLED` case
  geçişlerinde karşılık gelen karar/offer/enrolment evidence'ını zorunlu kılar;
- offer issuance ve enrolment confirmation için current actor, receipt ve
  evidence kontrollerini API yanında DB trigger'ında da tekrarlar;
- kurum principal/package/membership eşleşmesini fail-closed doğrular.

Kurum kullanıcısının legacy `users.role=institution_user` değeri yalnız portal
routing marker'ıdır. Yetki kaynağı değildir. Her API isteğinde sunucu:

1. oturumdaki numeric user ID'yi alır;
2. tek aktif `institution_membership` kaydını çözer;
3. aktif HUMAN principal ve sürümlü role package'i yeniden doğrular;
4. tenant ve relationship GUC'lerini aynı serializable transaction'a bağlar;
5. capability ALLOW/DENY sonucunu çözer;
6. relationship purpose ve data-scope setini çözer;
7. program/intake/assigned-case kapsamını hem sorguya hem RLS GUC'lerine bağlar.

İstemci body/query/header üzerinden tenant, relationship veya institution
authority seçemez. API token çağrıları institution portalında reddedilir.

## Rollout sınırları

Feature varsayılan olarak kapalıdır:

```text
INSTITUTION_ADMISSIONS_V1_MODE=off
INSTITUTION_ADMISSIONS_V1_USER_IDS=
INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE=false
```

Production'da ayrı `INSTITUTION_DATABASE_URL` ve exact
`INSTITUTION_DB_EXECUTOR_ROLE=fas_institution_executor` zorunludur. Kullanıcı
feature'ı açılsa bile executor role eksik/yanlış, superuser veya BYPASSRLS ise
istek fail-closed reddedilir.

Karar onayı, offer issuance, enrolment confirmation, requirement publish ve
team grant gibi yüksek etkili komutlar mevcut dilimde yalnız production dışı
explicit `INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE=true` ile denenebilir.
Production ortamında bu bayrak etkisizdir. Authoritative active-context,
step-up ve Control Plane adoption tamamlanmadan bu komutlar canlıya açılamaz.

## Doğrulanan kanıt

- Migration ledger: `85/85`.
- Fresh disposable PostgreSQL 16 migration ve clean replay: PASS.
- Pure institution contract tests: `9/9` PASS.
- PostgreSQL FORCE RLS, exact non-super/non-BYPASSRLS executor, server-side
  membership resolution, assigned-case/program/intake scope, actor spoof deny,
  auditor read-only, append-only evidence, maker-checker receipt ve
  evidence-bound decision/offer/enrolment lifecycle: `10/10` PASS.
- Migration authority: `29 PASS + 1` yalnız bu Windows hostunda Bash bulunmadığı
  için beklenen SKIP.
- Tenant writer inventory: `166/166` classified; yeni iki institution writer
  `db_enforced` ve external pilot quarantine altında.
- Legacy role-gate inventory: `72` route dosyası; institution route tek
  `corridor_migrated`, kalan `71` legacy quarantine, hata `0`.
- DB, API ve Edcons TypeScript: PASS.
- API production build: PASS.
- Edcons i18n parity (10 dil) ve production build: PASS.
- Dedicated Linux/Windows/PostgreSQL 16 Institution CI workflow'u ve genel
  convergence gate bağlantısı eklendi; remote run henüz oluşturulmadı.

## Canlı adoption için ayrı onay gerektiren işler

1. Bağımsız review ve branch/ruleset kararı.
2. Staging'de `0083–0084` migration adoption ve rollback rehearsal.
3. Dedicated non-super/non-BYPASSRLS executor rolü ve exact least-privilege
   grant setinin DBA tarafından kurulması.
4. Tenant/institution relationship, principal ve membership provisioning'inin
   Control Plane ChangeSet üzerinden yapılması.
5. Mevcut submission receipt'lerinden institution case projection adapter'ının
   default-off bağlanması; legacy application backfill yapılmaması.
6. Authoritative active-context + step-up + maker-checker kanıtının yüksek
   etkili komutlara bağlanması.
7. PII/data-sharing, retention ve kurum sözleşmesi onayı.
8. Consentli staging cohort UAT, SLA/analytics doğrulaması ve rollback kanıtı.

Bu maddeler tamamlanmadan production enablement, dış iletişim, kurum portalına
gerçek PII projection'ı veya portal automation execution **NO-GO**'dur.
