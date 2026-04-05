// PM2 ecosystem config — Find & Study
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 reload ecosystem.config.cjs --update-env
//   pm2 save

"use strict";

module.exports = {
  apps: [
    {
      name: "findandstudy-api",
      script: "./artifacts/api-server/dist/index.cjs",

      // Cluster mode: one process per CPU core
      exec_mode: "cluster",
      instances: "max",

      // Restart when heap exceeds 512 MB
      max_memory_restart: "512M",

      // Never watch files (use deploy script to restart)
      watch: false,
      ignore_watch: ["node_modules", "logs", "dist", ".git"],

      // Environment
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      },

      // Logs
      out_file: "./logs/api-out.log",
      error_file: "./logs/api-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      log_type: "json",

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      min_uptime: "10s",

      // Source maps for error traces
      node_args: "--enable-source-maps",
    },
  ],
};
