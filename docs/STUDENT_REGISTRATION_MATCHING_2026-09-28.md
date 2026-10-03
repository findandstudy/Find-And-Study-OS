# Student Registration Matching — 28 Eylül 2026

## Sonuç

Student Register akışından önce çalışan, mevcut katalog verisini kullanan
dinamik bir eşleştirme adımı eklendi. Öğrenci uyruk, tamamlanan eğitim, hedef
seviye, not sistemi/notu ve dil sınavı bilgisini beyan eder; sistem yalnız aktif
ve başvuruya açık üniversite/programlar arasından açıklanabilir öneriler üretir.
Sonuçlar kabul garantisi değildir ve beyanlar doğrulanmış evidence sayılmaz.

## Güvenlik ve factual sınırlar

- Bilinmeyen kabul kuralı “herkese açık” kabul edilmez; `review_required` olur.
- Not sistemleri arasında tahmini dönüşüm yapılmaz.
- Eski, sınav türü içermeyen dil puanı kesin uygunluk üretmez.
- Kabul kuralı ancak HTTPS kaynak, doğrulama tarihi ve geçerlilik bitişi birlikte
  mevcut ve güncelse kesin pass/fail üretir; süresi dolmuş veri review'a düşer.
- Üniversite genel kriterleri programda override yoksa miras alınır.
- Seçilen program kayıt anında yeniden değerlendirilir.
- Public endpoint IP bazlı PostgreSQL rate limit ve `private, no-store` kullanır.
- Kullanıcı, beyan profili ve doğrulama kodu yeni kayıt akışında tek transaction
  içinde yazılır.
- Runtime AI, yeni paralel katalog veya kopya Course Finder kurulmadı.

## Veri ve yönetim

`0126_student_registration_matching.sql` additive migration'ı:

- Üniversite genel nationality/academic/language kuralları ve evidence metadata,
- Program özel override alanları,
- Ayrı `student_registration_profiles` beyan kaydı

ekler. Admin Catalog üniversite/program düzenleyicisinde bu alanlar yönetilebilir.
Source URL, last verified ve valid until eksikse doğrulanmış kural kaydedilemez.

## Kanıt

- Workspace TypeScript build: PASS
- API bağımsız no-emit typecheck: PASS
- API production build: PASS
- Edcons i18n (23 locale), 114 UI contract testi, Vite production build,
  sitemap ve public bundle budget: PASS
- Student matching saf testleri: 11/11 PASS
- Student verification gate + IP rate-limit regresyonu: 12/12 PASS
- Migration statik doğrulama: 127 dosya / 127 journal PASS
- Göreve özel disposable PostgreSQL 16.15 fresh migration: 127/127 PASS
- DB sütun/ledger doğrulaması: PASS
- `git diff --check`: PASS

Disposable cluster yalnız `127.0.0.1:5433/fasos_apply_local` üzerinde çalıştı,
test sonunda durduruldu. Staging/production verisi, PII veya provider kullanılmadı.

## Açık release kapıları

- Staging'de gerçek ve kaynaklandırılmış üniversite/program kriterlerinin girişi.
- EN/TR dışındaki onboarding metinlerinin mevcut 23 locale sistemine çevrilmesi.
- Katalog büyüklüğünde p95/p99 sorgu ve indeks ölçümü.
- Gerçek mobil/RTL/erişilebilirlik browser UAT.
- Başvuru ekibinin `review_required` açıklamalarını iş akışında doğrulaması.

## Release durumu

**PARTIALLY READY** — kod ve fresh DB kapıları geçti; staging data-entry ve UAT
olmadan production'a hazır değildir. Commit, push veya deploy yapılmadı.
