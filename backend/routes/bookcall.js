'use strict';
const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

function getSheets() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

router.get('/ping', (_req, res) => res.json({ ok: true, t: Date.now() }));

router.post('/leads', async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      phone = '',
      country_code = '',
      website = '',
      company = '',
      notes = '',
      utm_source = '',
      utm_medium = '',
      utm_campaign = '',
      utm_term = '',
      utm_content = '',
    } = req.body || {};

    const row = [
      new Date().toISOString(),
      name, email, phone, country_code, website, company, notes,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      req.ip, req.headers['user-agent'] || '',
    ];

    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Leads!A:Z',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Sheets append error:', err?.response?.data || err);
    res.status(500).json({ ok: false, error: 'FAILED_SHEETS' });
  }
});

module.exports = router;
