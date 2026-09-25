const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[makerchamp] STRIPE_SECRET_KEY is not set — Stripe calls will fail.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20'
});

module.exports = stripe;
