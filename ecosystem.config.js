'use strict';

module.exports = {
  apps: [
    {
      name: 'openclaw-control-plane',
      script: 'index.js',
      cwd: '/Users/robotmac/openclaw/control-plane',
      env_file: '/Users/robotmac/openclaw/control-plane/.env'
    },
    {
      name: 'openclaw-merge-worker',
      script: 'workers/merge-worker.js',
      cwd: '/Users/robotmac/openclaw/control-plane',
      env_file: '/Users/robotmac/openclaw/control-plane/.env'
    },
    {
      name: 'openclaw-deploy-worker',
      script: 'workers/deploy-worker.js',
      cwd: '/Users/robotmac/openclaw/control-plane',
      env_file: '/Users/robotmac/openclaw/control-plane/.env'
    },
    {
      name: 'openclaw-verify-worker',
      script: 'workers/verify-worker.js',
      cwd: '/Users/robotmac/openclaw/control-plane',
      env_file: '/Users/robotmac/openclaw/control-plane/.env'
    },
    {
      name: 'openclaw-notify-worker',
      script: 'workers/notify-worker.js',
      cwd: '/Users/robotmac/openclaw/control-plane',
      env_file: '/Users/robotmac/openclaw/control-plane/.env'
    }
  ]
};
