# Staging yönetim paneli yerleşim envanteri

28 Kasım 2026 · İngilizce arayüz · Super Admin

Staging’de sol menüden açılan 51 panel rotası ve 21 alt görünüm incelendi. Tüm rotalar 1280 × 720’de ölçüldü. Genişlik sınırı ve taşma görülen ekranlar 1536, 1024 veya 390 pikselde tekrar açıldı. Academy bağlantısı harici portala gider. Aşağıdaki genişlikler CSS pikselidir. Panel sütunu, sol menü ve ortak kenar boşluklarından sonra kullanılabilen alanı gösterir.

## Doğrulanan yerleşim hataları

| Ekran | Gözlenen durum | Önerilen düzeltme |
|---|---|---|
| Finance → Commissions | 1280 px ekranda tablo 1159 px, tablo kabı 990 px. Kabın `overflow-x: hidden` ayarı Status sütununun bir kısmını ve Actions sütununun tamamını kesiyor. 1536 px’de sığıyor. 1024 px’de ayrıca ana panel 52 px taşıyor. 390 px’de ana panelde 700 px yatay taşma ölçüldü. | Yatay kaydırmayı tablo kabına al ve kontrol satırını mevcut alana göre sar. Durum ve işlem düğmelerinin klavye ve dokunmayla erişimini doğrula. |
| Catalog → Countries, Cities, Universities, Programs | 390 px’de tablo kapları 307 px. Tablolar sırasıyla 544, 476, 919 ve 1067 px. Kaplar `overflow-x: hidden` kullandığı için sağ sütunlar kırpılıyor. Universities sekmesinde dış panel de 233 px taşıyor. | Tabloları kendi alanında kaydırılabilir yap. Universities sekmesinde dış panelin de ekrana sığdığını doğrula. |
| Catalog → sekmeler | 390 px’de beş sekme yalnız ikon gösteriyor. Ekran okuyucu için ad ve görsel ipucu yok. | Var olan çevrilmiş sekme adlarını erişilebilir ad olarak kullan. Yer varsa metin etiketini koru. |

Leads ve Applications, tablonun gerektiğinde kendi alanında kayması için mevcut örnekler. Finance ve Catalog düzeltmelerinde ana panel ile yan menü bu davranışa göre sabit kalabilir.

## Genişlik kararı gereken ekranlar

13 rota kendi genişlik sınırından dolayı 1280 px’de ortak panelden dar. Listedeki diğer ekranlardan farklı boşluk oluşturan sınırlar 1536 px’de daha görünür.

| Kullanım | Ekranlar | Ölçüm ve öneri |
|---|---|---|
| Liste ve sıra takibi | Global Components, Navigation, AI Action Queue | İçerik 832 px. 1536 px’de ortak panel 1302 px. Listeyi ve araç çubuğunu ortak genişliğe yay. |
| İçerik listeleri | Blog, Collections, Forms, SEO Overrides, Translations, AI Document Extractors | İçerik 936 px. Tablolarda, kart listelerinde ve çok sütunlu araçlarda ortak genişliği kullan. Tekil metin düzenleme alanlarında satır uzunluğu sınırlanabilir. |
| Çalışma alanı | Team workspace | İçerik 728 px. 1536 px’de ortak panel 1302 px. Liste ve çalışma alanına ek genişlik ver. |
| Form ve ayar ekranları | Portal Credentials, AI Agent, Theme Builder ve Settings form sütunu | Portal Credentials 624 px, AI Agent 728 px, Theme Builder 832 px. Settings ana kabuğu tam genişlikte ve form sütunu 624 px. Formları okunabilir genişlikte tutup hizayı standartlaştırma veya tüm alanı kullanma kararı gerekiyor. |

## Sol menüdeki 51 rota

| # | Ekran | Rota | Panel / içerik | Gözlem |
|---:|---|---|---:|---|
| 1 | Dashboard | `/admin` | 1031 / 1031 | Ortak genişlik |
| 2 | Operations | `/admin/operations` | 1046 / 1046 | Ortak genişlik |
| 3 | Tasks | `/staff/tasks` | 1046 / 1046 | Ortak genişlik |
| 4 | Messages | `/staff/messages` | 1046 / 1046 | Bölmeli yerleşim panele sığıyor |
| 5 | Pipelines | `/staff/pipelines` | 1046 / 1046 | Ortak genişlik |
| 6 | Leads | `/staff/leads` | 1046 / 1046 | Tablonun kendi kaydırma alanı var |
| 7 | Students | `/staff/students` | 1046 / 1046 | Ortak genişlik |
| 8 | Applications | `/staff/applications` | 1046 / 1046 | Tablonun kendi kaydırma alanı var |
| 9 | Course Finder | `/staff/course-finder` | 1046 / 1046 | Ortak genişlik |
| 10 | Agents | `/staff/agents` | 1046 / 1046 | Ortak genişlik |
| 11 | Agency Applications | `/staff/agency-applications` | 1046 / 1046 | Ortak genişlik |
| 12 | Contracts | `/admin/contracts` | 1046 / 1046 | Ortak genişlik |
| 13 | Contract Templates | `/admin/contract-templates` | 1046 / 1046 | Ortak genişlik |
| 14 | University Contracts | `/admin/university-contracts` | 1046 / 1046 | Ortak genişlik |
| 15 | Company Contracts | `/admin/company-contracts` | 1046 / 1046 | Ortak genişlik |
| 16 | Self-Fill Links | `/admin/self-fill-links` | 1046 / 1046 | Ortak genişlik |
| 17 | Catalog | `/admin/catalog` | 1031 / 1031 | Mobilde tablo ve sekme sorunları |
| 18 | Finance | `/staff/finance` | 1031 / 1031 | Commissions sağ sütunları kesiliyor |
| 19 | Campaigns | `/admin/campaigns` | 1046 / 1046 | 1400 px üst sınırı |
| 20 | Social Media | `/admin/social` | 1046 / 1046 | Ortak genişlik |
| 21 | Pop-up Ads | `/admin/popups` | 1046 / 1046 | 1400 px üst sınırı |
| 22 | Embeds | `/admin/embeds` | 1046 / 1046 | Ortak genişlik |
| 23 | Pages | `/admin/website/pages` | 1031 / 1031 | 1680 px üst sınırı |
| 24 | Global Components | `/admin/website/global-components` | 1046 / 832 | Dar ve ortalanmış |
| 25 | Navigation | `/admin/website/navigation` | 1046 / 832 | Her iki sekme dar ve ortalanmış |
| 26 | Blog | `/admin/website/blog` | 1046 / 936 | 936 px üst sınırı |
| 27 | Collections | `/admin/website/collections` | 1046 / 936 | 936 px üst sınırı |
| 28 | Forms | `/admin/website/forms` | 1046 / 936 | 936 px üst sınırı |
| 29 | SEO Overrides | `/admin/website/seo` | 1031 / 936 | 936 px üst sınırı |
| 30 | Theme Builder | `/admin/website/theme` | 1031 / 832 | 832 px üst sınırı |
| 31 | Translations | `/admin/website/translations` | 1046 / 936 | 936 px üst sınırı |
| 32 | Publish History | `/admin/website/publish-history` | 1031 / 1031 | Ortak genişliğe sığıyor |
| 33 | Reporting & Intelligence | `/admin/reports` | 1031 / 1031 | Ortak genişlik |
| 34 | User Activity | `/admin/activity` | 1031 / 1031 | Ortak genişlik |
| 35 | Quality Report | `/admin/quality-report` | 1031 / 1031 | Ortak genişlik |
| 36 | Data Quality | `/admin/data-quality` | 1031 / 1031 | İç kaydırma alanı var |
| 37 | Team workspace | `/admin/agent-team-workspace` | 1046 / 728 | 728 px üst sınırı |
| 38 | Portal Automation | `/admin/portal-automation` | 1027 / 1027 | Varsayılan görünüm ve incelenen sekmeler panele sığıyor |
| 39 | Portal Credentials | `/admin/portal-credentials` | 1046 / 624 | Dar form |
| 40 | AI Personas | `/admin/ai-personas` | 1046 / 1046 | Ortak genişlik |
| 41 | Team Designer — Preview | `/admin/agent-team-preview/` | 1046 / 1046 | Ortak genişlik |
| 42 | AI Action Queue | `/admin/ai-action-queue` | 1046 / 832 | 832 px üst sınırı |
| 43 | AI Document Extractors | `/admin/ai-extractors` | 1031 / 936 | 936 px üst sınırı |
| 44 | AI Agent | `/admin/ai-agent` | 1031 / 728 | Dar ayar ekranı |
| 45 | Users | `/admin/users` | 1046 / 1046 | Ortak genişlik |
| 46 | Staff Cards | `/admin/staff-cards` | 1046 / 1046 | Ortak genişlik |
| 47 | Branches | `/admin/branches` | 1046 / 1046 | Ortak genişlik |
| 48 | Audit Log | `/admin/audit` | 1031 / 1031 | Ortak genişlik |
| 49 | System Health | `/admin/system-health` | 1031 / 1031 | Ortak genişlik |
| 50 | API Tokens | `/admin/api-tokens` | 1046 / 1046 | Ortak genişlik |
| 51 | Settings | `/admin/settings` | 1031 / 1031 | Form sütunu 624 px’de kalıyor |

## Açılan 21 alt görünüm

| Ekran | İncelenen alt görünümler | Sonuç |
|---|---|---|
| Finance | University Breakdown, Service Fees, Analytics | İncelenen veriyle ana panel sığıyor. Varsayılan Commissions sekmesinin hatası yukarıda. |
| Users | Roles & Permissions | 1031 px ve dış yatay taşma yok. |
| Catalog | Cities, Universities, Programs, Options | 1280 px’de tamamı sığıyor. 390 px’de üç veri tablosu sağdan kırpılıyor ve Universities ana paneli taşıyor. |
| Portal Automation | Automation Rules, Operations, Universities, Program Mapping, Adapters, Submission Board, Audit Log | 1280 px’de ana panel dışına yatay taşma yok. |
| Navigation | Footer Links | Header Main Menu gibi 832 px ile sınırlı. |
| Settings | Integrations | Ana panel 1031 px, form sütunu 624 px. |
| Pages | Managed pages, Templates & review, Program ortak detay şablonu editörü, About yönetilen sayfa editörü | Listeler ve About editörü 1031 px alana sığıyor. Program şablonu editörü 1280 px’de 1252 px genişliğinde bir modal açıyor. |

Ölçümler bu oturumda görülen veriyi ve ekran durumlarını kapsar. Kayıt bazlı bütün düzenleme formları, farklı kullanıcı rolleri ve her dil ayrı ayrı test edilmedi.
