const express = require('express');
const { google } = require('googleapis');
const router = express.Router();
const credentials = require('./credentials.json'); // Ajusta la ruta si el archivo está en otra carpeta

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

const spreadsheetId = '1MLX7gCPxMrtcpt4wk70by3-EnSc_iefG8gmPmnh48Tg'; // tu ID real
const sheetRange = 'Sheet1!A:B'; // nombre de tu hoja

router.post('/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[email, new Date().toISOString()]],
      },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo guardar el email' });
  }
});

module.exports = router;
