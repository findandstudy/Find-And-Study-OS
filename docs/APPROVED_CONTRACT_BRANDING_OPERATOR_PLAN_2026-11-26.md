# Onaylı profile1 / template49 işlemi ve staging eşleme planı

Kullanıcı son Apply + staging planını “yap” ile onayladı. Bu belge yalnız yerel operasyon hazırlığıdır; bu alt ajan uzak sisteme bağlanmadı, kod/veritabanı değiştirmedi. Uzak işlemlerin tek yürütücüsü root ajandır. [Onaylanan ön kontrol](APPLY_CONTRACT_SEND_PREFLIGHT_2026-11-26.md) içindeki dar kapsam korunur.

## Sabit girdiler

| Girdi | Exact değer |
|---|---|
| Kaynak |`c0a02d8c99f4baf98bc6d52e74813dfc36b7a3fb` |
| Canonical proposal SHA-256 |`70e69e31a2fa9223bea6c07d267d8bc06814257376ca2fd1e940980eb217eeaf` |
| Saklanacak49 body SHA-256 |`8acd631311960b96440f9389b8d65afb4b90a6d9e29a2b1db206cea50c29605b` |
| Yeni profile1 logo normalize PNG SHA-256 |`902221ef74cd780adb0ae628638f678c635c3f6fdd1e99758415d37a12068998` |
| Eski profile1 logo normalize PNG SHA-256 |`a49ea4eb2e76dc9472e4e97db501a55a5fe9ea6160f5b0355d1f202a39f8ab57` |
| Onaylanan sentetik49 PDF SHA-256 |`9179c56d6fd4c0b8d6a245a81384360ee8eaed24e45a044d2d54869def424fc2` |

Proposal/body/önceki satırların gerçek özel dosya yolları root'un VPS hazırlık manifestinden alınır; bu ajan bunları tahmin etmez. Ham proposal hash'i canonical body yerine kullanılmaz. Beklenen DB adı/adresi, release, storage kökü ve operator karar/backup receipt'leri mevcut onaylı manifestten yüklenir. Tam JSON/config/şirket imzası veya private içerik loglanmaz.

## Önce salt okunur doğrulama

1. Kaynak, proposal ve canonical body byte hash'lerini doğrula. Gerçek `sanitizeContractTemplateHtml(body) === body` ve görünür hukuki metin eşliği önceki preview kanıtıyla aynı olmalı. Profile/template JSON'u client girdisi veya yeni üretilmiş içerikle değiştirme.
2. Exact yeni public logo dosyasını yeni content-addressed anahtarda doğrula: normalize PNG,68.701 byte, yukarıdaki hash. Eski dosyayı overwrite etme. Exact-origin/allowlist Linux managed-public resolver'ından okunabilir olmalı; global integrations açılmamalı.
3. Profile1 tam mevcut JSON'u/updated_at/id/aktiflik ve eski logo URL'sini private inventory ile karşılaştır. Config değişikliği yalnız logoUrl; şirket imzası ve diğer alanlar byte/değer olarak aynı kalır.
4. Template49 tam satırı private inventory ile karşılaştır: version7, `supersedes_template_id=48`, draft, deleted_at NULL, beklenen brand profile ilişkisi; önceki body/config/intake/timestamps aynıdır. Template48 hâlâ yayımlanmış ve aynı kaynak body hash'indedir. Template14 ve profile2/Dorm için mevcut before hash'i kaydet.
5. Profile1 inheritor kümesi beklenen31,33,34,35,36,37,38,39,40,41,42,45,46,48 +draft47/49 olmalı. Beklenmeyen değişiklikte scope genişletme; dur.
6. API drain/durdurma, yeni DB/storage yedeği ve restore-list/checksum kanıtı onaylı genel plana göre tamamlanmış olmalı. Bu işlem yeni DB migration, global worker veya SMTP başlatmaz.

## Dar transaction

Tek bağlantı/transaction; bounded connection/statement/lock timeout. Beklenen satırlar private manifestten parametre olarak bağlanır; SQL'e string birleştirilmez. Sıra profile1 → template48 → template49 kilitleriyle sabit tutulur. Root'un mevcut private operator'ü kullanılabilir; yeni genel yönetim endpoint'i gerekmez.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT to_jsonb(p) FROM contract_brand_profiles p WHERE id=1 FOR UPDATE;
SELECT to_jsonb(t) FROM contract_templates t WHERE id IN (48,49) ORDER BY id FOR UPDATE;
```

Kilitlenen gerçek satırları manifestteki exact full row değerleriyle tekrar karşılaştır. Satır yokluğu, version/status drift, değişmiş body/branding veya beklenmeyen ilişki rollback sebebidir. Hiçbir current değeri yeni “beklenen” diye sessizce kabul etme.

Yayınlama doğrulamalarını mevcut `artifacts/api-server/src/routes/contractTemplates.ts:204` akışıyla aynı şekilde uygula:

- deleted_at NULL ve durum draft/review_pending; bu operasyonun exact manifesti49 için draft bekler;
- body boş değil; `intake_schema` gerçek JSON array;
- `mergeContractBranding(newProfileConfig, template.signing_page_config)` ardından `hasContractCompanySignature` PASS;
- canonical body ve onaylanan preview aynı; bu saf doğrulamalar dış istek yapmaz;
- reviewed/published actor alanları yalnız gerçek yetkili operator/session eşlemesiyle doldurulur. Kimlik uydurulmaz. Normal HTTP publish rotası `requireAuth` + `contract_templates.manage` ister; operator receipt açık kullanıcı onayıyla bağı korumalıdır.

Mevcut HTTP publish rotasının final UPDATE'i yalnız id ile filtreler; tek başına exact body/version CAS sağlamaz. API kapalıyken bu dar operator transaction'ında aynı iş kuralları ile ilave CAS birlikte kullanılır.

Örnek parametreli yazı sınırı (değerler private manifestten; çalıştırılmış değildir):

```sql
UPDATE contract_brand_profiles p
SET config=$1::jsonb, updated_at=transaction_timestamp()
WHERE p.id=1 AND to_jsonb(p)=$2::jsonb
RETURNING id;

UPDATE contract_templates t
SET body_html=$3, publication_status='published', is_active=true,
    reviewed_at=transaction_timestamp(), reviewed_by_user_id=$4,
    published_at=transaction_timestamp(), published_by_user_id=$4,
    updated_at=transaction_timestamp()
WHERE t.id=49 AND to_jsonb(t)=$5::jsonb
  AND t.version=7 AND t.supersedes_template_id=48
  AND t.publication_status='draft' AND t.deleted_at IS NULL
RETURNING id;
```

Her UPDATE tam1 satır üretmeli. Yeni profile JSON eski config'in yalnız logoUrl değişmiş halidir; signer image/text/policy yeniden serialize edilerek kaybedilmez. Template49 yazısı body ve yayınlama metadata'sıyla sınırlıdır; name/title/language/entity/intake/signing config/profile/version/supersedes alanları korunur. Template48 UPDATE edilmez. Aynı transaction'da before/after kontrollü tekrar okunur; body SHA ve canonical eşlik, profile farkı, template48 değişmezliği doğrulanır. Audit/operation receipt doğru actor/onay/source/before/after hash'leri içerir; ham HTML veya şirket imzasını genel audit payload'ına koyma.

Hata COMMIT öncesindeyse rollback. COMMIT yanıtı belirsizse kör retry veya ters UPDATE yok; exact iki kayıt ve receipt salt okunur yeniden değerlendirilir. Başarılı tekrar çağrı yeni yayınlama olayı üretmez. Son readback yalnız id/status/version/hash/rowcount ve unchanged boundary kanıtı verir.

Bu transaction `signed_contracts`, `signing_sessions`, agency/application, user veya mail kuyruğuna dokunmaz. Exact47 recovery/enrollment başka onaylı operator işlemidir; burada yinelenmez. Canlı DB restore ve eski PDF overwrite yapılmaz.

## Staging'de gerçekten kalan eşleme

Son belgeyle doğrulanan staging baseline: commit `8b7e865d5706cbf4549dbdbe2b8e71afda30978f`, release `staging-20261125T212446Z-8b7e865d5706`, image `sha256:3d7a0cf74bcc4196e837b68cd9897fe69bd67418035f2c65ffb8a0eb8da84f2d`. Güncel runtime yeniden attest edilmeden aynı kaldığı varsayılmaz.

Zaten mevcut: tasarım CSS'ini koruyan renderer/sanitizer, strict-CSP admin TEST preview, GET unsigned PDF, Chromium/font runtime, managed public logo, sahipliğe bağlı indirme, doğru SMTP acceptance/status metni. Bunları ikinci paralel sistemle değiştirme.

1. **Yeni imza alanı/parity:** Apply'ın `contractSigningFields.ts` saf alan/yorum/WhatsApp doğrulaması ve `SignFlow.tsx` gerekli alan UX'i henüz staging baseline'ında yok. Staging `publicSigning.ts` intake/status/row-lock ve `signContract.ts` preflight/snapshot-lock hunk'ları mevcut staging API/oturum akışına uyarlanmalı. Apply'ın tüm dosyalarını kopyalayıp staging farklarını ezme.
2. **Frozen pre-sign/PDF parity:** Apply `contractDeliveryPdf.ts` yeni durable queue'ya bağlıdır; staging mevcut `email_queue` mimarisini kullanır. Saf preflight/frozen-input doğrulaması module-local olarak yeniden kullanılmalı/ayrılmalı; Apply compatibility0067 migration'ı veya yeni gönderim tablosu staging'e kör kopyalanmamalı. Staging tarihsel worker taraması/mutable fallback hâlâ gönderim aktivasyonu engelidir.
3. **Tasarım/logo aktarımı:** Yalnız onaylanan canonical49 HTML/intake/metadata ve renkli public logo aktarılır. Staging ID'leri Apply49/profile1 ile aynı varsayılmaz; önceki transfer manifesti üzerinden environment-local eşleme kullanılır. Apply48'in staging'de18 olarak gözlendiği bile tek başına49 eşlemesi değildir. Önceki18 pasif DRAFT ve2 profile envanteri kontrol edilir; gereksiz duplicate açılmaz. Template14/Dorm korunur.
4. **İmza/veri sınırı:** Gerçek companySignatureDataUrl, kişisel imza, session/signed record, agency/application veya mail receipt staging'e aktarılmaz. Staging'e özgü TEST-only marka imzası/fixture izole testte kullanılabilir. Önceki transfer gibi içerik pasif DRAFT kalır; staging'de normal publish için gereken imza/actor doğrulaması yoksa bypass yapılmaz ve yayın ayrı eksik olarak raporlanır.
5. **Test/deploy:** Alan/alias/comment/admin-static/self-fill/signed-immutable/concurrency testleri; EN desktop/TR mobile/AR RTL gerekli alan UI; network-none Chromium ve gerçek yeni49 unsigned preview; logo/PDF byte doğrulaması çalışır. Mevcut CSP/noindex/non-root/PID/memory sınırları korunur. Yalnız staging app switch; DB/production container'ları, ledger ve ilgisiz servisler değişmez.
6. **Staging gönderim kapalı:** `BACKGROUND_JOBS_ENABLED=false`, `SIGNED_CONTRACT_PDF_WORKER_ENABLED=false`, `EMAIL_DELIVERY_DISABLED=true`, `ALLOW_LIVE_INTEGRATIONS=false`; diğer sosyal/AI kill switch'leri aynen korunur. Apply canary/future izinleri staging'e taşınmaz. Gerçek gönderim testi veya historical adoption yapılmış sayılmaz.

Kanıt kaynakları: staging worktree'deki `docs/STAGING_CONTRACT_PANEL_UAT_2026-11-26.md`, `docs/STAGING_CONTRACT_MAIL_PARITY_2026-11-25.md`, `docs/STAGING_CONTRACT_PDF_RUNTIME_2026-11-25.md`, `docs/AGENCY_CONTRACT_REPAIR_2026-11-25.md`. Sonuncudaki eski release sayıları final panel UAT belgesini supersede etmez. Staging'de gerçek kullanıcı Chrome profiline indirme kaydı önceki turda UNVERIFIED idi; yeni UAT bunu ayrıca doğrulamalıdır.
