const { Resend } = require('resend');

if (!process.env.RESEND_API_KEY) {
  console.warn('[makerchamp] RESEND_API_KEY is not set — merchant emails will fail.');
}

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = resend;
