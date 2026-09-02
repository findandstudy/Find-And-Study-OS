# Institution Admissions v1 — Review Packet

Tarih: 2 Eylül 2026

Branch: `codex/institution-admissions-v1-20260902`

Durum: Yerel ve PR-ready; push, PR, merge, staging/production deploy ve `Next` sync yapılmadı.

## Dondurulmuş kaynak kimliği

- Target base: `822112fb471ad53365034b9b928b5510b4c06d81`
- Foundation commit: `9e8ef92d073511759860ba9d640be9f767cab311`
- Code-bearing head: `6cb9dd3e2d7f33644c4b98d948d6a91fc02791e4`
- Code-bearing tree: `82e52312f660c56fc5ad11871e0e4086388b4bc4`
- Base → code farkı: `6 commit / 51 dosya / 8.922 ekleme / 31 silme`
- Binary-patch SHA-256: `7812ea20a9c670ac6b3b0c86c19061c8710c04f5c7a9d1020d7cac8e1d1fe2f3`
- Binary-patch byte uzunluğu: `512541`

Bu dosya ve onu taşıyan commit review-infrastructure-only'dir. Kendi commit
kimliğini dairesel olarak mühürleyemez; reviewer branch'in exact final HEAD'ini
ayrıca kabul etmelidir.

## İnceleme kapsamı

1. Ayrı `/institution` portal shell'i ve capability tabanlı 13 kurum çalışma
   alanı: home, queue, applications, review, decisions, offers, programs/intakes,
   requirements, SLA, analytics, integrations, team ve masked audit projection.
2. Altı versioned HUMAN kurum role package'i; hiçbir membership veya canlı grant
   seed edilmez.
3. `0083` ile 13 tenant/relationship-owned, UUIDv7 ve FORCE-RLS tablo.
4. `0084` ile purpose/data-scope, program/intake/assigned-case, current actor,
   role separation, evidence lineage ve receipt-bound lifecycle hardening.
5. Decision maker/checker ayrımı; approval receipt olmadan karar ilerlemez.
6. Approved decision/issued offer/confirmed enrolment kanıtı olmadan case state
   ilerlemez.
7. Program/intake değişiklikleri legacy kataloğa doğrudan yazılmaz; yalnız
   `PENDING_INTERNAL_CHANGESET` talebi üretir.
8. Integration projection secret-reference-only ve external execution kapalıdır.
9. `0085` ile external institution selection, exact step-up, append-only
   authorization receipt ve membership ChangeSet request tabloları; toplam 17
   Institution tablosu FORCE RLS'tir.
10. Ed25519 v2 active-context, current session fingerprint, impersonation deny,
    exact policy/data-scope ve transaction-stable authority row lock'u.
11. Direct team grant ve SLA activation yoktur; yalnız Control Plane bekleyen
    membership request ve SLA draft üretilebilir.
12. Feature default-off; local-assurance escape hatch'i tamamen kaldırılmıştır.
13. `0086` ile başarılı gerçek submission'ı tenant/branch + kurum + program +
    portal mapping doğrulamasından sonra PII-minimized review case'e dönüştüren,
    append-only receipt-bound ve concurrency-safe intake corridor'u; toplam 18
    Institution tablosu FORCE RLS'tir.
14. Intake executor tablo yetkisiz/EXECUTE-only; fonksiyon owner'ı ayrı
    NOLOGIN/non-super/non-BYPASSRLS ve feature `off|allowlist|all`, varsayılan
    `off`tur. Route/worker/backfill/live wiring yoktur.
15. Dedicated Institution workflow'u ve genel convergence CI bağlantısı.

## Yerel kanıt matrisi

| Kapı | Sonuç |
|---|---:|
| Migration ledger | `87/87` PASS |
| Fresh PostgreSQL 16.15 migration | PASS |
| Clean migration replay | PASS |
| Institution pure contracts | `10/10` PASS |
| Institution active-context authorization | `9/9` PASS |
| Institution intake pure contract | `4/4` PASS |
| Least-privilege PostgreSQL/RLS/lifecycle | `12/12` PASS |
| EXECUTE-only PostgreSQL case intake | `5/5` PASS |
| Migration authority | `30 PASS + 1 Bash-unavailable SKIP` |
| Package-manager contract | `6/6` PASS |
| Tenant writer inventory | `167/167`, `2.226` surface, hata `0` |
| Legacy role-gate inventory | `72` route, `1` corridor, hata `0` |
| Full workspace typecheck | PASS |
| 10 dil i18n eşliği | PASS |
| API production build | PASS |
| Edcons production build + sitemap | PASS |
| Data-boundary regressions | `4/4` PASS |
| Integration DB safety | `11/11` PASS |
| Live security regressions | `31/31` PASS |
| Workflow YAML parse | PASS |
| `git diff --check` | PASS |

PostgreSQL kanıtı yeni ve yalnız loopback'te oluşturulan
`fas_dev_institution_intake5` disposable DB'sinde, exact
`fas_institution_executor` ile `fas_institution_intake_executor`
non-super/non-owner/non-BYPASSRLS rolleriyle alındı.
Production credential, dump veya PII kullanılmadı.

## Reviewer için kritik kontrol listesi

- `institution_user` değerinin yalnız portal routing marker'ı kaldığını ve hiçbir
  capability vermediğini doğrula.
- Relationship purpose'un exact `admissions.review`, data-scope'ların endpoint
  bazında fail-closed olduğunu doğrula.
- Institution Admin'in reviewer olmadığını; Auditor'ın profile/team PII görmeden
  masked read-only kaldığını doğrula.
- Reviewer assigned case/program/intake dışına çıkamadığını doğrula.
- Maker-checker receipt'i ile decision state'in aynı transaction zincirinde
  eşleştiğini doğrula.
- Offer/enrolment state ve case projection'larının kanıtsız ilerlemediğini doğrula.
- Local-assurance escape hatch'inin kod ve env örneklerinden kaldırıldığını doğrula.
- Critical mutation'ların exact v2 active-context, current selection/session,
  relationship purpose/data-scope, step-up ve policy version'a bağlı olduğunu doğrula.
- Authorization receipt insert'inin current authority satırlarını kilitlediğini,
  executor'ın bu satırlarda UPDATE privilege'ı olmadığını doğrula.
- Team/SLA mutation'larının active grant/policy değil yalnız Control Plane
  bekleyen request/draft ürettiğini doğrula.
- Intake'ın yalnız gerçek başarılı source'u kabul ettiğini; tenant/branch,
  institution/program ve portal mapping mismatch'te fail-closed kaldığını;
  source external ref'in yalnız hash'inin saklandığını doğrula.
- Intake executor'ın hiçbir Institution tablosunda SELECT/INSERT yetkisi
  olmadığını; same-source concurrency'nin tek case/receipt ürettiğini doğrula.
- CI'nın generic PR'larda eski frozen convergence manifestini yanlışlıkla
  zorlamadığını, frozen branch'te ise zorlamaya devam ettiğini doğrula.

## Değişmeyen NO-GO sınırları

- Production veya staging migration/adoption yapılmadı.
- Gerçek institution relationship, principal, membership veya PII provision edilmedi.
- Active-context ve step-up doğrulama kodu bağlıdır; ancak canlı selection
  issuer, MFA step-up issuer, Ed25519 key-ring ve Control Plane apply corridor'u
  provision edilmediği için kritik komutlar canlıda fail-closed kalır.
- External message, offer delivery, SIS/API/webhook veya portal automation çalışmadı.
- Intake adapter hazırdır ama hiçbir route/worker'a bağlanmadı; hiçbir legacy
  application backfill edilmedi ve gerçek applicant PII projection yapılmadı.
- Consentli cohort UAT, Privacy/Legal, retention, rollback rehearsal ve bağımsız
  security review tamamlanmadan production enablement yoktur.
- Bu branch push/merge/deploy veya `Find-And-Study-OS-Next` sync için tek başına
  yetki vermez.
