const express = require('express');
const http = require('http');
const app = express();

// Existing /health route assumed here
// ...

// GET /health/builder endpoint
app.get('/health/builder', (req, res) => {
  const options = {
    hostname: 'localhost',
    port: 3201,
    path: '/health',
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  };

  const builderReq = http.request(options, (builderRes) => {
    let data = '';
    builderRes.on('data', (chunk) => {
      data += chunk;
    });
    builderRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        res.status(builderRes.statusCode).json(json);
      } catch (e) {
        res.status(502).json({ error: 'Invalid JSON from builder health endpoint' });
      }
    });
  });

  builderReq.on('error', (err) => {
    res.status(502).json({ error: 'Unable to reach builder health endpoint' });
  });

  builderReq.end();
});

// Existing app.listen or other routes assumed here
// ...
