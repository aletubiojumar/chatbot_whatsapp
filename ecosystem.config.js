const path = require('path');
const APP_DIR = __dirname;

module.exports = {
  apps: [
    {
      name: 'chatbot_whatsapp',
      script: 'src/bot/index.js',
      cwd: APP_DIR,
      env: {
        NODE_ENV: 'production',
        EXCEL_PATH: path.join(APP_DIR, 'data', 'allianz_latest.xlsx'),
      },
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 5000,
      kill_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(APP_DIR, 'logs', 'pm2-error.log'),
      out_file: path.join(APP_DIR, 'logs', 'pm2-out.log'),
    },
  ],
};
