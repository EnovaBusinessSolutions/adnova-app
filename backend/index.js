// backend/index.js
require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

const PORT = process.env.PORT || 3000;

// ✅ Conexión a MongoDB usando la variable MONGO_URI
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Conectado a MongoDB Atlas"))
.catch((err) => console.error("❌ Error al conectar con MongoDB:", err));

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Página principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Registro de usuarios
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashedPassword });
    res.status(201).json({ success: true, message: 'Usuario registrado con éxito' });
  } catch (err) {
    console.error("❌ Error al registrar usuario:", err);
    res.status(400).json({ success: false, message: 'No se pudo registrar el usuario' });
  }
});

// Login de usuarios
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Login recibido:', email);

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    res.status(200).json({ success: true, token: 'fake-token' }); // Puedes cambiar a JWT después
  } catch (err) {
    console.error("❌ Error al hacer login:", err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

// Rutas de frontend
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

// Ruta 404
app.use((req, res) => {
  res.status(404).send('Página no encontrada');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
