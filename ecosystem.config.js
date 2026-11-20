// PM2 ecosystem configuration
// Usage:
//   pm2 start ecosystem.config.js --env production
//   pm2 restart ecosystem.config.js --env production
//   pm2 logs company-site
//
// 로그 회전(pm2-logrotate) 설치는 docs/operations.md 참고.

module.exports = {
  apps: [
    {
      name: 'company-site',
      script: 'app.js',
      cwd: __dirname,

      // fork 모드 유지: SQLite/세션 메모리 공유 이슈 없는 단순 단일 인스턴스
      exec_mode: 'fork',
      instances: 1,

      // 메모리/재시작 정책
      max_memory_restart: '500M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000,            // 10초 이내 종료 시 비정상으로 간주
      restart_delay: 4000,
      kill_timeout: 5000,           // SIGTERM 후 5초 대기 후 SIGKILL

      // 로그 (pm2-logrotate가 자동 회전)
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,                   // 각 로그 라인에 timestamp 자동 추가

      // 환경
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
