const express = require('express');
const http = require('http');
const app = express();

// Existing routes and middleware

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

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

  const request = http.request(options, (response) => {
    let data = '';
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      try {
        const json = JSON.parse(data);
        res.status(200).json(json);
      } catch (err) {
        res.status(502).json({ error: 'Invalid JSON from builder health endpoint' });
      }
    });
  });

  request.on('error', (err) => {
    res.status(502).json({ error: 'Unable to reach builder health endpoint' });
  });

  request.end();
});

// ...rest of the server setup and routes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
