const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'rexu-api',
      cwd: path.resolve(__dirname, '../apps/api'),
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        TRUST_PROXY: '1',
      },
    },
  ],
};
