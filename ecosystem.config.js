module.exports = {
  apps: [
    {
      name: '3doku-server',
      script: './server/dist/index.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 39500,
        CORS_ORIGINS: 'https://shilmanlior2608.ddns.net:39000',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 39500,
        CORS_ORIGINS: 'https://shilmanlior2608.ddns.net:39000',
      },
      error_file: './server/logs/err.log',
      out_file: './server/logs/out.log',
      log_file: './server/logs/combined.log',
      time: true,
      merge_logs: true,
      max_memory_restart: '300M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
