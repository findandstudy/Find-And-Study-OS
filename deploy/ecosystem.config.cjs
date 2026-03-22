module.exports = {
  apps: [
    {
      name: "findandstudy-os",
      script: "./artifacts/api-server/dist/index.cjs",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: "10s",
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: false,
      autorestart: true,
      watch: false,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/error.log",
      out_file: "./logs/output.log",
      log_file: "./logs/combined.log",
    },
  ],
};
