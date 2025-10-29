// backend/services/mailer.js
'use strict';

const nodemailer = require('nodemailer');
const crypto = require('crypto');

const FROM = process.env.SMTP_FROM || process.env.SMTP_USER;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const secure = SMTP_PORT === 465;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
  return transporter;
}

async function sendMail({ to, subject, text, html, headers = {} }) {
  const tx = getTransporter();
  const info = await tx.sendMail({
    from: `"Adnova AI" <${FROM}>`,
    to,
    subject,
    text,
    html,
    replyTo: FROM,
    headers: { 'X-Entity-Ref-ID': crypto.randomUUID(), ...headers },
  });
  return info;
}

async function verify() {
  const tx = getTransporter();
  return tx.verify();
}

module.exports = { sendMail, verify };
