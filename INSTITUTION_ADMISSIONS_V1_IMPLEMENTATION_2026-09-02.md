# Institution Admissions v1 — Yerel Uygulama Kaydı

Tarih: 2 Eylül 2026
Branch: `codex/institution-admissions-v1-20260902`
Durum: Yerel uygulama, active-context/step-up authority hardening, receipt-bound case-intake, consent-bound verified-evidence sharing ve reviewed-evidence enrolment confirmation disposable PostgreSQL kanıtı tamamlandı; production, staging, `Next`, dış iletişim ve portal automation wiring'i değiştirilmedi.

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
- SLA değişiklik talebi/versioning ve PII-minimized aggregate analytics.
- PII içermeyen, append-only hash zincirini gösteren ayrı masked audit ekranı.
- Program/intake değişiklikleri legacy katalogda doğrudan yazılmaz; append-only
  `PENDING_INTERNAL_CHANGESET` talebi üretir.
- Integration ekranı secret-reference-only projection döndürür; ham credential
  ve dış execution yoktur.
- Karar, offer, enrolment, requirement publish, team ve SLA mutation'ları exact
  Ed25519 active-context, server-session fingerprint, current selection ve
  gerektiğinde tek kullanımlık step-up receipt olmadan çalışmaz.
- Team grant ve SLA activation kurum executor'ıyla yapılamaz; yalnız
  `PENDING_CONTROL_PLANE`/`DRAFT` talep üretilebilir.
- Gerçek ve başarılı legacy portal submission'dan kurum review queue'suna
  PII-minimized application case açan, varsayılan kapalı ve idempotent intake
  adapter'ı eklendi. Ham external reference, result JSON, screenshot, öğrenci
  adı, e-posta, pasaport veya belge içeriği kurum case/receipt'ine yazılmaz.
- Kurum reviewer'ı artık istemciden serbest bir evidence SHA-256 değeri giremez.
  Yalnız güncel consent ile kuruma açılmış, Journey tarafından doğrulanmış ve
  program/intake/case kapsamına uyan PII-minimized evidence manifestini seçer.
  Belge byte'ı ve private object reference kurum portalına çıkmaz.
- Enrolment confirmation da istemci SHA-256 değeri kabul etmez. Yalnız exact
  güncel yayımlanmış kurum requirement'ına bağlı son `VERIFIED` assessment ve
  aktif consent'i olan evidence-share receipt üzerinden ilerler.

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

Additive `0085_institution_active_context_step_up.sql` dört tablo daha ekler:

14. `institution_active_context_selections`
15. `institution_step_up_receipts`
16. `institution_command_authorization_receipts`
17. `institution_membership_change_requests`

Bu migration selection/session generation, request hash, capability, resource,
policy ve data-scope'a exact bağlı tek kullanımlık step-up corridor'u kurar.
PII-free authorization receipt insert'i sırasında current tenant, external
institution relationship, HUMAN principal, institution membership, role
package, capability ve policy satırları transaction sonuna kadar kilitlenip
yeniden doğrulanır. FORCE-RLS lock politikaları yalnız kilit görünürlüğü verir;
executor ilgili authority tablolarında UPDATE privilege'a sahip değildir.
Doğrudan membership grant ve SLA activation policy'leri kaldırılmıştır.

Additive `0086_institution_case_intake_receipts.sql` on sekizinci Institution
tablosunu ekler:

18. `institution_case_intake_receipts`

Intake corridor'u yalnız `mode=real` ve `submitted|already_exists|accepted`
durumundaki, silinmemiş ve external receipt referansı bulunan bir portal
submission'ı kabul eder. Aynı transaction içinde tenant→legacy branch,
application→student, relationship→institution, program→institution ve portal
university mapping bağlarını yeniden doğrular. Source snapshot, external ref,
command ve receipt SHA-256 olarak dondurulur; review case'e yalnız deterministik
`STU-...` maskeli referans ve boş `shared_profile` yazılır. Receipt append-only,
case üzerindeki source/receipt bağı immutable'dır.

Adapter `fas_institution_intake_executor` rolünde tablo yetkisi olmadan yalnız
`SECURITY DEFINER` fonksiyonunu çalıştırır. Fonksiyon sahibi ayrı NOLOGIN,
non-super/non-BYPASSRLS roldür; FORCE RLS açık kalır. Aynı submission için
advisory transaction lock + unique constraint ile eşzamanlı çağrılar tek case
ve tek receipt üretir; takip eden çağrı `REPLAY` döndürür. Worker/route wiring'i,
backfill ve canlı feature activation bu dilimde yoktur.

Additive `0087_institution_evidence_share_receipts.sql` on dokuzuncu
Institution tablosunu ekler:

19. `institution_evidence_share_receipts`

Evidence-share corridor'u Journey application case, subject, verified evidence
receipt, güncel `VERIFIED` requirement result ve en son aktif
`institution.admissions.evidence_share` / `in_app` consent receipt'ini exact
tenant + relationship + institution case bağıyla doğrular. Ham evidence ref
yerine DB tarafında SHA-256, source snapshot ve append-only receipt hash'i
tutulur. Idempotent `REPLAY` dahi relationship/evidence/consent durumunu yeniden
doğrular; consent geri çekildikten sonra eski receipt tekrar çözülemez.

Paylaşım yazıcısı exact `fas_institution_evidence_share_executor` rolünde tablo
yetkisi olmadan yalnız SECURITY DEFINER fonksiyonunu çalıştırır. Fonksiyon sahibi
ayrı NOLOGIN, non-super ve non-BYPASSRLS roldür. Assessment trigger'ı client
zamanını DB saatiyle değiştirir; exact share receipt/hash, current reviewer
membership, program/intake/case scope ve güncel consent'i aynı transaction'da
tekrar doğrular. Intake-created case'lerde receipt zorunludur; migration öncesi
historical/manual case'ler additive uyumluluk için korunur. Share adapter'ı
default-unwired'dır; consent oluşturmaz, belge taşımaz ve dış gönderim yapmaz.

Additive `0088_institution_enrolment_evidence_binding.sql` yeni tablo eklemeden
`institution_enrolments` kaydını exact share receipt ve assessment kimliğine
bağlar. Composite FK'ler case/relationship/tenant bağını korur. Ayrı
SECURITY DEFINER resolver current `DECISION_APPROVER` actor/membership,
`admissions.review` relationship, `application.enrolment` data scope, uygun
case state, en son aktif consent, en son assessment ve program/intake'e ait
etkin `PUBLISHED` requirement set içindeki `ENROLMENT_CONFIRMATION` evidence
type'ını DB saatiyle yeniden doğrular.

Migration öncesindeki confirmed satırlar additive uyumlulukla korunur; fakat
migration sonrasındaki her yeni confirmation receipt-bound'dır. Portal eski
serbest hash prompt'unu kaldırır, reviewer assessment'ını exact yayımlanmış
requirement kimliğiyle gönderir ve eşleşen requirement yoksa confirmation
akışını açmaz.

Kurum kullanıcısının legacy `users.role=institution_user` değeri yalnız portal
routing marker'ıdır. Yetki kaynağı değildir. Her API isteğinde sunucu:

1. oturumdaki numeric user ID'yi alır;
2. tek aktif `institution_membership` kaydını çözer;
3. aktif HUMAN principal ve sürümlü role package'i yeniden doğrular;
4. tenant ve relationship GUC'lerini aynı serializable transaction'a bağlar;
5. capability ALLOW/DENY sonucunu çözer;
6. relationship purpose ve data-scope setini çözer;
7. program/intake/assigned-case kapsamını hem sorguya hem RLS GUC'lerine bağlar.

Yüksek etkili komutlarda buna ek olarak sunucu, signed version-2 active-context
envelope'unu exact environment/cell/issuer/key-ring ile doğrular; legacy HMAC
downgrade'ı, API token'ı ve impersonation'ı reddeder; selection ID, session
generation ve server-derived session fingerprint'i current DB state ile
eşleştirir; step-up receipt'i aynı transaction'da tüketir.

İstemci body/query/header üzerinden tenant, relationship veya institution
authority seçemez. API token çağrıları institution portalında reddedilir.

## Rollout sınırları

Feature varsayılan olarak kapalıdır:

```text
INSTITUTION_ADMISSIONS_V1_MODE=off
INSTITUTION_ADMISSIONS_V1_USER_IDS=
INSTITUTION_ACTIVE_CONTEXT_AUDIENCE=
INSTITUTION_ACTIVE_CONTEXT_ENVIRONMENT_ID=
INSTITUTION_ACTIVE_CONTEXT_CELL_ID=
INSTITUTION_ACTIVE_CONTEXT_ISSUER_ID=
INSTITUTION_ACTIVE_CONTEXT_KEY_RING_JSON=
INSTITUTION_CASE_INTAKE_V1_MODE=off
INSTITUTION_CASE_INTAKE_V1_RELATIONSHIP_ALLOWLIST=
INSTITUTION_EVIDENCE_SHARE_V1_MODE=off
INSTITUTION_EVIDENCE_SHARE_V1_RELATIONSHIP_ALLOWLIST=
```

Production'da ayrı `INSTITUTION_DATABASE_URL` ve exact
`INSTITUTION_DB_EXECUTOR_ROLE=fas_institution_executor` zorunludur. Kullanıcı
feature'ı açılsa bile executor role eksik/yanlış, superuser veya BYPASSRLS ise
istek fail-closed reddedilir.

Local-assurance escape hatch kaldırılmıştır. Karar onayı, offer issuance,
enrolment confirmation ve requirement publish exact active-context + current
authority + step-up + domain maker-checker/evidence ister. Team ve SLA
endpoint'leri aynı güvenceyle yalnız Control Plane'de ayrıca onaylanacak talep
üretir. Issuer/key-ring ve selection/step-up issuance provision edilmeden bu
komutlar fail-closed kalır.

## Doğrulanan kanıt

- Migration ledger: `89/89`.
- Fresh disposable PostgreSQL 16 migration ve clean replay: PASS.
- Production-prefix `66/66 → 89/89` adoption ve clean replay: PASS.
- Pure institution contract tests: `12/12` PASS.
- Pure institution case-intake config/result tests: `4/4` PASS.
- Pure institution evidence-share config/request/result tests: `4/4` PASS.
- PostgreSQL FORCE RLS, exact non-super/non-BYPASSRLS executor, server-side
  membership resolution, assigned-case/program/intake scope, actor spoof deny,
  auditor read-only, append-only evidence, maker-checker receipt ve
  evidence-bound decision/offer/enrolment lifecycle, exact current-authority
  row lock, single-use step-up, membership grant deny ve SLA draft-only sınırı:
  `12/12` PASS.
- Intake exact EXECUTE-only owner/executor ayrımı, default-off deny, dry-source
  deny, PII-minimized projection, append-only receipt, idempotency ve same-source
  concurrency: `5/5` PASS.
- Evidence-share/enrolment exact EXECUTE-only owner/executor ayrımı, current consent,
  verified source, PII-minimized receipt, replay revalidation, concurrency,
  server timestamp, reviewer membership, program/intake scope, published
  enrolment requirement, exact assessment binding, raw-hash deny ve withdrawal
  deny: `8/8` PASS.
- Migration authority: `31 PASS + 1` yalnız bu Windows hostunda Bash bulunmadığı
  için beklenen SKIP.
- Tenant writer inventory: `168/168` classified, `2.231` surface; dört
  institution writer `db_enforced` ve external pilot quarantine altında.
- Legacy role-gate inventory: `72` route dosyası; institution route tek
  `corridor_migrated`, kalan `71` legacy quarantine, hata `0`.
- DB, API ve Edcons TypeScript: PASS.
- API production build: PASS.
- Edcons i18n parity (10 dil) ve production build: PASS.
- Control Plane foundation, Student Journey G45, ChangeSet adapter, durable
  audit/reconciliation ve active-context session/lifecycle/repair PostgreSQL
  kapıları: PASS.
- Dedicated Linux/Windows/PostgreSQL 16 Institution CI workflow'u ve genel
  convergence gate bağlantısı eklendi; remote run henüz oluşturulmadı.

## Canlı adoption için ayrı onay gerektiren işler

1. Bağımsız review ve branch/ruleset kararı.
2. Staging'de `0083–0088` migration adoption ve rollback rehearsal.
3. Dedicated non-super/non-BYPASSRLS executor rolü ve exact least-privilege
   grant setinin DBA tarafından kurulması.
4. Tenant/institution relationship, principal ve membership provisioning'inin
   Control Plane ChangeSet üzerinden yapılması.
5. Hazır intake ve evidence-share adapter'larının yalnız consentli staging
   relationship allowlist'i için ayrı internal worker/job'a bağlanması; legacy
   application backfill yapılmaması ve raw belge/object ref taşınmaması.
6. Authoritative active-context selection issuer, Ed25519 key-ring ve MFA
   step-up receipt issuer'ının ayrı review ile provision edilmesi.
7. PII/data-sharing, retention ve kurum sözleşmesi onayı.
8. Consentli staging cohort UAT, SLA/analytics doğrulaması ve rollback kanıtı.

Bu maddeler tamamlanmadan production enablement, dış iletişim, kurum portalına
gerçek PII projection'ı veya portal automation execution **NO-GO**'dur.
