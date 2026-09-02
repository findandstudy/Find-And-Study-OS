# Institution Admissions v1 — Review Packet

Tarih: 2 Eylül 2026

Branch: `codex/institution-admissions-v1-20260902`

Durum: Yerel ve PR-ready; push, PR, merge, staging/production deploy ve `Next` sync yapılmadı.

## Dondurulmuş kaynak kimliği

- Target base: `822112fb471ad53365034b9b928b5510b4c06d81`
- Foundation commit: `9e8ef92d073511759860ba9d640be9f767cab311`
- Code-bearing head: `b117e71a013e57efe5e9ce67f777c6b2fe39472f`
- Code-bearing tree: `782daa3c4166e7db074bbb2f983562863e2edd8f`
- Base → code farkı: `4 commit / 46 dosya / 7.507 ekleme / 31 silme`
- Binary-patch SHA-256: `4400a1164d4647f9b244ab3ae9cb15145697c9c3ffce2abf3d396b432dbfe329`
- Binary-patch byte uzunluğu: `438510`

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
13. Dedicated Institution workflow'u ve genel convergence CI bağlantısı.

## Yerel kanıt matrisi

| Kapı | Sonuç |
|---|---:|
| Migration ledger | `86/86` PASS |
| Fresh PostgreSQL 16.15 migration | PASS |
| Clean migration replay | PASS |
| Institution pure contracts | `9/9` PASS |
| Institution active-context authorization | `9/9` PASS |
| Least-privilege PostgreSQL/RLS/lifecycle | `12/12` PASS |
| Migration authority | `29 PASS + 1 Bash-unavailable SKIP` |
| Package-manager contract | `6/6` PASS |
| Tenant writer inventory | `166/166`, hata `0` |
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
`fas_dev_institution_authority5` disposable DB'sinde, exact
`fas_institution_executor` non-super/non-owner/non-BYPASSRLS rolüyle alındı.
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
- CI'nın generic PR'larda eski frozen convergence manifestini yanlışlıkla
  zorlamadığını, frozen branch'te ise zorlamaya devam ettiğini doğrula.

## Değişmeyen NO-GO sınırları

- Production veya staging migration/adoption yapılmadı.
- Gerçek institution relationship, principal, membership veya PII provision edilmedi.
- Active-context ve step-up doğrulama kodu bağlıdır; ancak canlı selection
  issuer, MFA step-up issuer, Ed25519 key-ring ve Control Plane apply corridor'u
  provision edilmediği için kritik komutlar canlıda fail-closed kalır.
- External message, offer delivery, SIS/API/webhook veya portal automation çalışmadı.
- Consentli cohort UAT, Privacy/Legal, retention, rollback rehearsal ve bağımsız
  security review tamamlanmadan production enablement yoktur.
- Bu branch push/merge/deploy veya `Find-And-Study-OS-Next` sync için tek başına
  yetki vermez.
