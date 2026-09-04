# Reporting & Intelligence Center — v1 sözleşmesi

Tarih: 3 Eylül 2026
Durum: Uygulama dilimi; production wiring yok

## Amaç

Dağınık dashboard, aktivite, finans ve veri-kalitesi yüzeylerini tek bir `/admin/reports` bilgi mimarisinde birleştirmek. Bu merkez operasyonel sistemin yerine geçmez; karar vermek için tanımlı, tekrarlanabilir ve yetki kontrollü aggregate projection sunar.

## v1 kapsamı

- Yönetim özeti: lead, öğrenci ve başvuru hacmi; eşit önceki dönem karşılaştırması; aktif ve stale başvuru stoğu.
- Lead funnel: sabit lead oluşturma kohortu üzerinden güncel dönüşüm, öğrenci, başvuru, submitted ve won sonuçları.
- Başvuru operasyonu: güncel stage stoğu, seçili oluşturma kohortu, `updated_at` tabanlı geçici aging proxy'si ve destinasyon performansı.
- Finans: yalnız yetkili kullanıcılar için teyitli komisyon, hizmet ücreti ve transaction akışı; her para birimi ayrı.
- Veri kalitesi: kimlik döndürmeyen, salt-okunur kaynak/lineage/catalog/assignment/integrity/duplicate kontrolleri.
- Aynı ekranda sürümlü metrik sözlüğü, ölçüm zamanı, tazelik, filtre ve uyarı bilgisi.

## Değişmez ölçüm kuralları

1. API tarihleri `YYYY-MM-DD`, timezone `UTC`, bitiş günü dahil ve aralık en fazla 366 gündür.
2. `created_cohort` ile `current_inventory` aynı sayıymış gibi sunulmaz.
3. Bir dönüşüm oranı paydası sıfırsa sonuç `0%` değil `null/—` olur.
4. Para birimleri kur tanımı ve kaynağı olmadan birleştirilmez. V1 özgün currency bazında sonuç döndürür.
5. Stage başarısı hard-coded label yerine mümkün olduğunda `pipeline_stages.variant` (`won/lost`) üzerinden çözülür.
6. `applications.updated_at` yalnız geçici aging proxy'sidir; SLA veya gerçek stage-entry zamanı değildir.
7. API/DB hatası hiçbir zaman boş dizi veya sıfır başarı sonucu gibi maskelenmez.
8. V1 projection kişisel veri içermez; email, telefon, pasaport, ad veya record ID dönmez.
9. Export v1'de kapalıdır. Alan bazlı purpose, permission, audit ve retention kararı olmadan açılmaz.
10. Bütün sorgular salt-okunur transaction içinde ve statement timeout ile çalışır.
11. Şube kapsamı istemciden güvenilmez; sunucudaki kullanıcı/rol bağından çözülür. Super Admin dışındaki kullanıcılar yalnız görünür şubelerinin aggregate sonuçlarını ve filtre seçeneklerini alır; kapsam dışı branch ID isteği `403` ile fail-closed reddedilir.

## Yetki matrisi

| Capability                           | Super Admin | Admin | Manager |       Accountant |
| ------------------------------------ | ----------: | ----: | ------: | ---------------: |
| `reporting.view`                     |           ✓ |     ✓ |       ✓ |                ✓ |
| `reporting.operations`               |           ✓ |     ✓ |       ✓ |                — |
| `reporting.finance` + `finance.view` |           ✓ |     ✓ |       ✓ |                ✓ |
| `reporting.workforce`                |           ✓ |     ✓ |       ✓ |                — |
| `reporting.export`                   |           ✓ |     ✓ |       ✓ | ✓ (v1 UI kapalı) |
| `reporting.manage`                   |           ✓ |     ✓ |       — |                — |

Per-user false override nihai iptaldir. Custom role'lara migration ile otomatik grant verilmez.

## API sözleşmesi

- `GET /api/reporting/meta`
- `GET /api/reporting/command-center`
- `GET /api/reporting/funnel`
- `GET /api/reporting/applications`
- `GET /api/reporting/finance`
- `GET /api/reporting/data-quality`

Her ölçüm yanıtı `schemaVersion`, `metricVersion`, `asOf`, effective filters, freshness, latency, privacy classification ve warnings içerir.

## Sonraki onay kapıları

- Canonical stage-transition event/snapshot ile gerçek stage aging ve SLA.
- Institution, workforce ve communication raporlarının aynı semantic layer'a eklenmesi.
- Snapshot/materialized view kararı için ölçülmüş sorgu hacmi ve DB maliyeti.
- PII-safe drill-down ve export için field-level authorization + durable export audit.
- Scheduled reports/alerts için recipient purpose, consent, retention ve delivery receipt.
- Tahmin/AI için veri kalitesi, bias/eval, explanation ve human-decision sınırları.
