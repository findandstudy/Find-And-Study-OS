/**
 * PM2 ecosystem configuration — portal-automation-worker
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart portal-automation-worker
 *   pm2 logs   portal-automation-worker
 *   pm2 stop   portal-automation-worker
 */

module.exports = {
  apps: [
    {
      name: "portal-automation-worker",
      script: "./dist/worker.js",
      instances: 1,
      exec_mode: "fork",

      // Memory limit — restart automatically if OOM
      max_memory_restart: "1G",

      // Environment
      env: {
        NODE_ENV: "production",
        PORTAL_HEADLESS: "true",
      },

      // Logging
      out_file: "./logs/worker-out.log",
      error_file: "./logs/worker-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Restart policy
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",

      // Shutdown timeout — allow chromium to exit cleanly
      kill_timeout: 15000,

      // Watch (disable in production)
      watch: false,
    },
  ],
};
