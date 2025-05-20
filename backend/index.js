// backend/index.js

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Endpoint de login simulado
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (email === 'admin@adnova.com' && password === '123456') {
    return res.status(200).json({ success: true, token: 'fake-token' });
  }

  return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
