'use strict';

module.exports = {
  apps: [
    {
      name: 'streakkeeper',
      script: './main.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
