// PM2 ecosystem config — Find And Study OS (tek yetkili kaynak)
// Production güncellemeleri yalnızca preflight korumalı deploy/deploy.sh
// üzerinden yapılır. Config'i doğrudan `pm2 start` ile çalıştırmayın.
//
// NOT: Root dizinindeki ecosystem.config.cjs bu dosyayı referans alır.

"use strict";

const API_PROCESS_NAME = "fasos-apply-api";
const PORTAL_WORKER_PROCESS_NAME = "findandstudy-portal-worker";

module.exports = {
  apps: [
    {
      name: API_PROCESS_NAME,
      script: "./artifacts/api-server/dist/index.cjs",

      // Worker tekilleştirme tamamlanana kadar API de tek process çalışır.
      exec_mode: "fork",
      instances: 1,

      // Heap 512 MB'ı geçince yeniden başlat
      max_memory_restart: "512M",

      // Dosya değişikliklerini izleme — deploy scripti yeniden başlatır
      watch: false,
      ignore_watch: ["node_modules", "logs", "dist", ".git"],

      // Ortam değişkenleri (pm2 start --env production ile etkinleşir)
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      },

      // Log dosyaları
      out_file: "./logs/api-out.log",
      error_file: "./logs/api-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      log_type: "json",

      // Graceful shutdown — wait_ready: true, process.send('ready') beklenir
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Kilitlenme sonrası otomatik yeniden başlatma
      autorestart: true,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 2000,
      min_uptime: "10s",

      // Hata izleri için kaynak haritaları
      node_args: "--enable-source-maps",
    },

    // -------------------------------------------------------------------------
    // Portal Automation Worker
    // -------------------------------------------------------------------------
    // Fork mode — tekil instance (SKIP LOCKED sayesinde birden fazla çalışmak
    // güvenli, ama bellek maliyeti yüksek; gerekirse instances artırılabilir).
    // tsx yorumlayıcısı sayesinde TypeScript kaynak dosyasını doğrudan çalıştırır
    // (workspace deps'in TS source export ettiği monorepo yapısıyla uyumlu).
    {
      name: PORTAL_WORKER_PROCESS_NAME,
      script: "./artifacts/portal-automation-worker/src/worker.ts",
      interpreter: "./artifacts/portal-automation-worker/node_modules/.bin/tsx",

      exec_mode: "fork",
      instances: 1,

      // Chromium process'leri için 1 GB heap
      max_memory_restart: "1G",

      watch: false,

      env_production: {
        NODE_ENV: "production",
        // tsx heap + kaynak haritaları
        NODE_OPTIONS: "--max-old-space-size=512 --enable-source-maps",
        PLAYWRIGHT_HEADLESS: "true",
      },

      // Loglar — API server'dan ayrı dosyalar
      out_file: "./logs/portal-worker-out.log",
      error_file: "./logs/portal-worker-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Graceful shutdown — Chromium'un temiz kapanması için
      kill_timeout: 15000,

      autorestart: true,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: "10s",
    },
  ],
  processNames: {
    api: API_PROCESS_NAME,
    portalWorker: PORTAL_WORKER_PROCESS_NAME,
  },
};
