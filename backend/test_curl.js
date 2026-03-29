const http = require('http');
const https = require('https');
https.get('https://adray-app-staging-german.onrender.com/api/analytics/shogun.mx/wordpress-users-online?window_minutes=30&limit=6', {
  headers: {
    // maybe need auth?
    'Cookie': 'connect.sid=...' 
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Length:', data.length, 'Data preview:', data.substring(0, 500)));
});
