// server.js
require('dotenv').config();           
const express = require('express');
const path    = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/secure', require('./backend/routes/secure'));

app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
});
