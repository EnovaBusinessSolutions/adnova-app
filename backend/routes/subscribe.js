// backend/routes/subscribe.js
const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

/* =========================
   Config / Helpers
========================= */
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function readGoogleCredentials() {
  let raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) return null;

  try {
    raw = raw.trim();

    // Si viene en base64, decodificar
    if (!raw.startsWith('{')) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }

    const json = JSON.parse(raw);

    // Arreglar saltos de línea del private_key si vinieron escapados
    if (json.private_key && json.private_key.includes('\\n')) {
      json.private_key = json.private_key.replace(/\\n/g, '\n');
    }

    return json;
  } catch (e) {
    console.error('⚠️ GOOGLE_CREDENTIALS inválido:', e.message);
    return null; // No tumbar el server si hay mala config
  }
}

const credentials = readGoogleCredentials();

// Instancia de auth (si hay credenciales válidas)
let auth = null;
if (credentials) {
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

// Variables de entorno (evitamos hardcodear IDs)
const spreadsheetId = process.env.GOOGLE_SHEETS_ID || '';
const sheetRange = process.env.GOOGLE_SHEETS_RANGE || 'Sheet1!A:B';

/* =========================
   Ruta: POST /api/subscribe
   Body esperado: { email: string }
========================= */
router.post('/subscribe', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email requerido' });
    }

    if (!auth) {
      return res.status(503).json({ error: 'Google Sheets no configurado' });
    }
    if (!spreadsheetId) {
      return res.status(500).json({ error: 'Falta GOOGLE_SHEETS_ID' });
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[email, new Date().toISOString()]],
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('❌ subscribe error:', err.response?.data || err.message || err);
    return res.status(500).json({ error: 'No se pudo guardar el email' });
  }
});

module.exports = router;
