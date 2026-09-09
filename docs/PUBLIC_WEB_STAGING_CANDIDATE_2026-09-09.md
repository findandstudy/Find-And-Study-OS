# Public Web — Staging Aday ve Review Paketi

Tarih: 9 Eylül 2026
Durum: **Yerel aday hazır; remote review, staging ve production NO-GO**
Branch: `codex/public-web-foundation-20260908`

## Dondurulmuş kimlik

| Alan | Değer |
|---|---|
| Karşılaştırma tabanı | `e6edad6a3de34f1c597687753a8c18d0f8248bcb` |
| Code/config-bearing head | `cce81223c7399bb6f3b33ade7a52101c8f825e64` |
| Tree | `f03cef485af9928198bfc00edee5a810bc58e609` |
| Base→head binary patch SHA-256 | `909b2b1bcfeff5441d2cfe7d68d0b3d809835070e40652420df652ddbadc9649` |
| Değişim | 22 commit, 95 dosya, +15.312 / -195 |
| Migration ledger | 120 SQL / 120 journal |

Bu belge code/config hash'inin parçası değildir. Aday kimliği yukarıdaki exact
head'dir; review veya staging öncesi head değişirse tree, patch hash ve bütün
kanıtlar yeniden üretilir.

## Adayın kapsamı

- Tenant/organization ve FORCE RLS sınırlarında versioned public content,
  evidence, review, approval, publish/unpublish ve receipt omurgası.
- Mevcut `website_pages`, `website_blog_posts`, program, university ve
  destination kaynaklarını ikinci bir hakikat deposu yaratmadan governed
  publication projection'ına bağlayan API ve SSR teslimatı.
- Program, university, destination, guide ve genel CMS sayfalarında canonical,
  hreflang, JSON-LD, noindex ve fail-closed çeviri davranışı.
- 23 locale, 200.000 program ve 2.000 üniversite hedefi için on-demand render,
  bounded cache, in-flight coalescing ve en fazla 5.000 URL'lik sitemap shard'ları.
- Yayındaki hedeflerle sınırlı related/internal-link graph, güvenli canonical
  redirect ve kaldırılmış içerik için `410 Gone` route-alias ledger'ı.
- Admin Publication Center read model/API/UI ve verilen program/university HTML
  prototiplerinin mevcut React + SSR bileşen sistemine data-bound uyarlaması.
- Yeni public-web saf testlerinin convergence ve staging workflow'larına; gerçek
  PostgreSQL kapılarının convergence workflow'una bağlanması.

## Exact-head yerel kanıt

| Kapı | Sonuç |
|---|---:|
| Full workspace typecheck | PASS |
| API production build | PASS |
| Edcons i18n | PASS — 5.027 kullanılan anahtar, 23 dil parity |
| Edcons public template tests | PASS — 5/5 |
| Edcons production build + static sitemap | PASS |
| Migration ledger | PASS — 120/120 |
| Public pure contract suites | PASS — 56/56 |
| Public PostgreSQL suites | PASS — 4/4 |
| Security regressions | PASS — 35/35 |
| Rate-limit/IP security | PASS — 6/6 |
| Package-manager guard | PASS — 6/6 |
| CI wiring contract | PASS — 3/3 |

Public pure toplamı: foundation 8, command 4, store adapter 4, publication read
model 2, localized entity 4, list/scale 13, route 4, render 9, discovery 5 ve
scale 3 testtir.

Yerel disposable PostgreSQL 16 üzerindeki dört suite public foundation,
catalog graph, public render ve discovery/localization/route-alias davranışını
kanıtladı. Production credential veya production verisi kullanılmadı.

## Yerel performans eşiği

| Ölçüm | Örnek | p95 | Kapı |
|---|---:|---:|---:|
| SSR origin | 23 | 20,2 ms | `< 800 ms` |
| SSR cache hit | 100 | 20,5 ms | `< 250 ms` |
| Public API | 40 | 23,8 ms | `< 300 ms` |

Bu ölçüm sentetiktir; staging ağ/CDN/browser Core Web Vitals kanıtı değildir.

## Staging'e geçmeden zorunlu sıra

1. Exact code/config head'i doğru remote branch'e fast-forward push et.
2. Taslak PR aç veya mevcut doğru PR'ı bu exact head'e bağla; bağımsız reviewer
   authorization, tenant/RLS, XSS/SSR, sitemap ve cache invalidation sınırlarını
   incelesin.
3. Remote convergence CI'ın aynı exact head üzerinde Linux/static, Windows ve
   disposable PostgreSQL job'larını yeşil tamamladığını doğrula.
4. Staging deploy manifestini reviewed head, beklenen migration prefix ve
   rollback release'iyle bağla; staging veritabanında yalnız reviewed `0109–0119`
   additive migrations'ını çalıştır.
5. İlk rollout'u `PUBLIC_WEB_RENDER_MODE=allowlist`, sitemap/internal-link
   modlarını `off` tutarak az sayıda program/university/destination rotasında yap.
6. Login/admin/student/staff/institution yüzeyleri için regresyon smoke; public
   rotalar için 200/308/404/410, canonical/hreflang/JSON-LD, cache ve XSS UAT yap.
7. Lighthouse mobile/desktop, gerçek CDN cache HIT/MISS, origin p95/p99, DB pool,
   error rate ve bot crawl ölçümünü kaydet.
8. Yalnız kanıt başarılıysa `PUBLIC_WEB_SITEMAP_MODE=published` ve
   `PUBLIC_WEB_INTERNAL_LINK_MODE=published` için ayrı approval ver.

## Rollback

- Feature değişkenlerini tekrar `off` yap; bu yeni public davranışı fail-closed
  kapatır ve eski SPA yüzeyini korur.
- Uygulama release symlink'ini doğrulanmış önceki staging release'ine döndür.
- Additive migration tablolarını acil rollback sırasında silme; writer'lar ve
  publication rollout kapalı tutulur. Schema cleanup ayrı reviewed ChangeSet'tir.
- Sitemap/CDN cache'lerini yeni index üretmeden purge et; yanlış URL'ler için
  alias/410 kaydı ancak maker-checker yayın akışıyla değiştirilir.

## Açık kalan NO-GO'lar

- Remote push/PR/exact-head Actions kanıtı yoktur.
- Bağımsız security/architecture review yoktur.
- Staging deploy ve gerçek browser/crawler/CDN UAT yapılmamıştır.
- Toplu içerik backfill, AI çeviri yayınlama ve public indexing aktive değildir.
- Production deploy, public index açma ve `Find-And-Study-OS-Next` sync bu paketin
  yetkisi dışındadır.

Bu paket deploy yetkisi değildir; `AGENTS.md` içindeki daha geniş güvenlik,
review ve production NO-GO sınırlarını gevşetmez.
