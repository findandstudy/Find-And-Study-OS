# Public Web Foundation — Yerel Gate Kanıtı

Tarih: 9 Eylül 2026  
Durum: **Yerel uygulama tamamlandı; staging/production aktivasyonu NO-GO**  
Branch: `codex/public-web-foundation-20260908`  
Code-bearing head: `f6ab2b4b30f9973765dac5544ab0363494fe762b`
Karşılaştırma tabanı: `e6edad6a` (`origin/codex/operations-social-staging-20260905`)

## Teslim edilen dilim

- Tenant ve organization sınırlarına bağlı public web content foundation.
- Active-context ve capability doğrulamalı, idempotent publication command/store.
- Admin Publication Center read model, API ve UI.
- Ölçeklenebilir public program/university API'leri ve detay sayfaları.
- University ve destination içeriklerinin exact `PUBLISHED` çok dilli revizyondan API + SSR teslimatı.
- Çevirisi olmayan İngilizce dışı university/destination rotalarının İngilizce metne düşmeden fail-closed kapanması.
- Çevrilmiş destination canonical slug çözümleme, locale-aware destination listesi ve toplu/N+1'siz related university yerelleştirmesi.
- Aktif route-alias ledger'ından yalnız yayındaki hedefe 301/308 ve kaldırılan içeriğe 410 teslimatı; hedef/path doğrulaması ve bounded cache.
- Default-off, allowlist/all kontrollü semantic SSR/ISR render pilotu.
- Canonical URL, doğrulanmış hreflang, JSON-LD ve dinamik sitemap üretimi.
- Yalnız gerçekten `PUBLISHED + INDEX` olan ve ilgili dilde teslim edilebilen kayıtların discovery katmanına alınması.
- 200.000 program, 2.000 üniversite ve 23 dil hedefi için bounded sitemap/HTML ölçek kapısı.

## Exact-head doğrulama özeti

| Kapı | Sonuç |
|---|---:|
| Full workspace TypeScript typecheck | PASS |
| API production build | PASS |
| Edcons TypeScript typecheck | PASS |
| Edcons i18n parity | PASS — 23 dil |
| Edcons production build | PASS |
| Migration ledger | PASS — 120 dosya / 120 journal |
| Public web foundation PostgreSQL | PASS — 1/1 |
| Catalog entity graph PostgreSQL | PASS — 1/1 |
| Publication store | PASS — 4/4 |
| Public localized entity contract | PASS — 4/4 |
| Public catalog route contract | PASS — 4/4 |
| Public catalog render contract | PASS — 9/9 |
| Public web discovery contract | PASS — 5/5 |
| Public web discovery PostgreSQL | PASS — 1/1 |
| Public web scale gate | PASS — 3/3 |
| Security regressions | PASS — 35/35 |

Derlemedeki mevcut source-map lookup ve 500 kB üzeri chunk mesajları uyarıdır; build'i başarısız kılmamıştır. Bundle ayrıştırma performans işi ayrı bir kapı olarak korunur.

## Yerel performans kanıtı

Araç yalnız açık opt-in ile, `fas_migrator@127.0.0.1:5433/fasos_apply_local` disposable veritabanına karşı çalıştırıldı. Production credential veya veri kullanılmadı.

| Ölçüm | Örnek | p95 |
|---|---:|---:|
| SSR origin | 23 | 30,5 ms |
| SSR cache hit | 100 | 26,4 ms |
| Public API | 40 | 23,3 ms |

Bu sayılar yerel sentetik ölçümdür; gerçek edge-cache, ağ, CDN, bot trafiği veya kullanıcı Core Web Vitals kanıtı değildir.

## Ölçek sözleşmesi

- 200.000 program + 2.000 üniversite × 23 locale = 4.646.000 olası URL, önceden render edilmez.
- Sitemap'ler en fazla 5.000 URL'lik bounded shard'lara ayrılır; hedef envanter 944 sitemap dosyasıdır.
- En kötü 5.000 URL / 23 hreflang shard sentetik testte yaklaşık 134–155 ms aralığında ve 50 MiB heap tavanının altında kaldı.
- SSR cache 5 dakika fresh, 1 saat stale, en fazla 500 entry ve in-flight coalescing kullanır.
- Discovery projection cache 5 dakika, en fazla 5.000 entry ve hedefli invalidation kullanır.

## Varsayılan-kapalı aktivasyon sınırı

Staging ve production ortamları bu çalışma tarafından değiştirilmedi. Aşağıdaki değişkenler opt-in yapılmadıkça yeni runtime davranışı açılmaz:

```text
PUBLIC_WEB_RENDER_MODE=off
PUBLIC_WEB_RENDER_ALLOWLIST=
PUBLIC_WEB_SITEMAP_MODE=off
PUBLIC_WEB_TENANT_ID=
PUBLIC_WEB_ORGANIZATION_ID=
```

`PUBLIC_WEB_SITEMAP_MODE=published` yalnız sitemap üretimini açmaz. Aynı
tenant/organization scope'unda university ve destination detayları için exact
`PUBLISHED` revizyonu teslimat kaynağı yapar. İngilizce dışındaki bir locale'de
uygun `translation_status=PUBLISHED` revizyonu yoksa sayfa İngilizce metne
düşmez; API `404` ve SSR noindex/not-found üretir. `NOINDEX` durumundaki
yayınlanmış revizyon okunabilir, fakat discovery ve hreflang grafiğine girmez.

Geçersiz rollout modu veya geçersiz tenant/organization UUID'si fail-closed davranır.

## Bilinen sınırlar ve sonraki kapılar

1. Staging smoke/UAT, gerçek crawler davranışı, Lighthouse/Core Web Vitals, CDN cache ve invalidation kanıtı alınmamıştır.
2. Bulk content import/backfill ve AI translation publication otomatik olarak açılmamıştır.
3. Frontend build başarılıdır; bazı dil paketleri 500 kB uyarı eşiğini aşmaktadır ve gerçek trafik ölçümüyle ayrı bundle bütçesi uygulanmalıdır.
4. GitHub push/PR, bağımsız review, CI ve deployment bu yerel gate'in dışında kalır.
5. Production wiring, veri backfill veya public index açma için ayrı açık onay ve rollback planı gerekir.

Bu belge staging veya production deploy yetkisi değildir. Projenin `AGENTS.md` içindeki daha geniş NO-GO, review ve production güvenlik kapıları aynen geçerlidir.
