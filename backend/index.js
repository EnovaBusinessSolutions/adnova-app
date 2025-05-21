// Login de usuarios
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Login recibido:', email);

  // 🛡️ Validación básica
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

    res.status(200).json({ success: true, token: 'fake-token' }); // Reemplazable por JWT
  } catch (err) {
    console.error("❌ Error al hacer login:", err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});
