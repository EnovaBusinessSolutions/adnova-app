// backend/index.js

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Mostrar mensaje si acceden al inicio
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '../public')));

// Permitir CORS y JSON
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

// RUTAS LIMPIAS SIN .html
app.get("/onboarding", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/onboarding.html'));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get("/configuracion", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configuracion.html'));
});

app.get("/audit", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/audit.html'));
});

app.get("/pixel-verifier", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pixel-verifier.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
