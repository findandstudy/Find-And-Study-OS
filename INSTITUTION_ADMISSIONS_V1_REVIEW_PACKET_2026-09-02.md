# Institution Admissions v1 — Review Packet

Tarih: 2 Eylül 2026

Branch: `codex/institution-admissions-v1-20260902`

Durum: Yerel ve PR-ready; push, PR, merge, staging/production deploy ve `Next` sync yapılmadı.

## Dondurulmuş kaynak kimliği

- Target base: `822112fb471ad53365034b9b928b5510b4c06d81`
- Foundation commit: `9e8ef92d073511759860ba9d640be9f767cab311`
- Code-bearing head: `0461c88f9d7fdf02ace2063b1b3d6c1fa0a68c30`
- Code-bearing tree: `f26b88e59715d6f70bb5101fd120d0c28ea55166`
- Base → code farkı: `2 commit / 41 dosya / 5.275 ekleme / 31 silme`
- Binary-patch SHA-256: `f5ac4f4b85fbdad148b5f813081b2259734ebbc6339e206ec0aada510e97f182`
- Binary-patch byte uzunluğu: `323115`

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
9. Feature default-off; production local-assurance escape hatch'i yoktur.
10. Dedicated Institution workflow'u ve genel convergence CI bağlantısı.

## Yerel kanıt matrisi

| Kapı | Sonuç |
|---|---:|
| Migration ledger | `85/85` PASS |
| Fresh PostgreSQL 16.15 migration | PASS |
| Clean migration replay | PASS |
| Institution pure contracts | `9/9` PASS |
| Least-privilege PostgreSQL/RLS/lifecycle | `10/10` PASS |
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
`fas_dev_institution_final` disposable DB'sinde, exact
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
- `INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE` bayrağının production'da etkisiz
  olduğunu doğrula.
- CI'nın generic PR'larda eski frozen convergence manifestini yanlışlıkla
  zorlamadığını, frozen branch'te ise zorlamaya devam ettiğini doğrula.

## Değişmeyen NO-GO sınırları

- Production veya staging migration/adoption yapılmadı.
- Gerçek institution relationship, principal, membership veya PII provision edilmedi.
- Authoritative active-context, step-up ve Control Plane ChangeSet adoption'ı
  yüksek etkili komutlara canlı olarak bağlanmadı.
- External message, offer delivery, SIS/API/webhook veya portal automation çalışmadı.
- Consentli cohort UAT, Privacy/Legal, retention, rollback rehearsal ve bağımsız
  security review tamamlanmadan production enablement yoktur.
- Bu branch push/merge/deploy veya `Find-And-Study-OS-Next` sync için tek başına
  yetki vermez.
