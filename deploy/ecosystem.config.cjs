// PM2 ecosystem config — EduConsult OS (yetkili kaynak)
// Kullanım:
//   pm2 start deploy/ecosystem.config.cjs --env production
//   pm2 reload deploy/ecosystem.config.cjs --update-env
//   pm2 save
//
// NOT: Root dizinindeki ecosystem.config.cjs bu dosyayı referans alır.

"use strict";

module.exports = {
  apps: [
    {
      name: "edconsult-os-api",
      script: "./artifacts/api-server/dist/index.cjs",

      // Cluster mode: CPU çekirdek sayısı kadar process
      exec_mode: "cluster",
      instances: "max",

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
  ],
};
