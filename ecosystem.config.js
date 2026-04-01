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
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
