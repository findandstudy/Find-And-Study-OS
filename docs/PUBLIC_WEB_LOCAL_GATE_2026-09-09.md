# Public Web Foundation — Yerel Gate Kanıtı

Tarih: 9 Eylül 2026  
Durum: **Yerel uygulama tamamlandı; staging/production aktivasyonu NO-GO**  
Branch: `codex/public-web-foundation-20260908`  
Code-bearing head: `149b8676fd75901933dfde59b99a93be0cf2db60`  
Karşılaştırma tabanı: `e6edad6a` (`origin/codex/operations-social-staging-20260905`)

## Teslim edilen dilim

- Tenant ve organization sınırlarına bağlı public web content foundation.
- Active-context ve capability doğrulamalı, idempotent publication command/store.
- Admin Publication Center read model, API ve UI.
- Ölçeklenebilir public program/university API'leri ve detay sayfaları.
- Default-off, allowlist/all kontrollü semantic SSR/ISR render pilotu.
- Canonical URL, doğrulanmış hreflang, JSON-LD ve dinamik sitemap üretimi.
- Yalnız gerçekten `PUBLISHED + INDEX` olan ve ilgili dilde teslim edilebilen kayıtların discovery katmanına alınması.
- 200.000 program, 2.000 üniversite ve 23 dil hedefi için bounded sitemap/HTML ölçek kapısı.

## Exact-head doğrulama özeti

| Kapı | Sonuç |
|---|---:|
| API TypeScript typecheck | PASS |
| API production build | PASS |
| Edcons TypeScript typecheck | PASS |
| Edcons i18n parity | PASS — 23 dil |
| Edcons production build | PASS |
| Migration ledger | PASS — 120 dosya / 120 journal |
| Public web foundation PostgreSQL | PASS — 1/1 |
| Catalog entity graph PostgreSQL | PASS — 1/1 |
| Publication store | PASS — 4/4 |
| Public catalog render contract | PASS — 5/5 |
| Public web scale gate | PASS — 3/3 |
| Security regressions | PASS — 35/35 |

Derlemedeki mevcut source-map lookup ve 500 kB üzeri chunk mesajları uyarıdır; build'i başarısız kılmamıştır. Bundle ayrıştırma performans işi ayrı bir kapı olarak korunur.

## Yerel performans kanıtı

Araç yalnız açık opt-in ile, `fas_migrator@127.0.0.1:5433/fasos_apply_local` disposable veritabanına karşı çalıştırıldı. Production credential veya veri kullanılmadı.

| Ölçüm | Örnek | p95 |
|---|---:|---:|
| SSR origin | 23 | 21,0 ms |
| SSR cache hit | 100 | 25,1 ms |
| Public API | 40 | 29,3 ms |

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

Geçersiz rollout modu veya geçersiz tenant/organization UUID'si fail-closed davranır.

## Bilinen sınırlar ve sonraki kapılar

1. University sayfalarında İngilizce dışı gerçek yerelleştirilmiş içerik projection'ı henüz yoktur; bu nedenle bu URL'ler indexlenmez ve sitemap'e girmez.
2. Destination/country/city, CMS page ve article/blog için yönetilen dynamic public delivery read model ve gerçek canonical route tamamlanmadan sitemap'e eklenmez.
3. Staging smoke/UAT, gerçek crawler davranışı, Lighthouse/Core Web Vitals, CDN cache ve invalidation kanıtı alınmamıştır.
4. Bulk content import/backfill ve AI translation publication otomatik olarak açılmamıştır.
5. GitHub push/PR, bağımsız review, CI ve deployment bu yerel gate'in dışında kalır.
6. Production wiring, veri backfill veya public index açma için ayrı açık onay ve rollback planı gerekir.

Bu belge staging veya production deploy yetkisi değildir. Projenin `AGENTS.md` içindeki daha geniş NO-GO, review ve production güvenlik kapıları aynen geçerlidir.
