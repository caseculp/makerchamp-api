const express = require('express');
const prisma = require('../lib/prisma');
const stripe = require('../lib/stripe');
const easypost = require('../lib/easypost');
const resend = require('../lib/resend');
const AppError = require('../lib/AppError');

const router = express.Router();

const PLATFORM_FEE_CENTS = Number(process.env.PLATFORM_FEE_CENTS || 200); // $2.00 default

/**
 * Validates the shape of a create-order request body.
 * Throws AppError(400, ...) on the first problem found.
 */
function validateCreateOrderPayload(body) {
  const required = ['merchantId', 'customerName', 'customerEmail', 'shippingAddress', 'itemPriceCents'];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw new AppError(400, `Missing required field: ${field}`);
    }
  }

  const { street1, city, state, zip } = body.shippingAddress || {};
  if (!street1 || !city || !state || !zip) {
    throw new AppError(400, 'shippingAddress must include street1, city, state, and zip');
  }

  if (!Number.isInteger(body.itemPriceCents) || body.itemPriceCents <= 0) {
    throw new AppError(400, 'itemPriceCents must be a positive integer (in cents)');
  }
}

/**
 * POST /api/v1/orders/create
 *
 * Body: { merchantId, customerName, customerEmail, shippingAddress, itemPriceCents }
 *
 * 1. Creates a Stripe PaymentIntent as a Connect destination charge, splitting
 *    off PLATFORM_FEE_CENTS for Makerchamp and routing the rest to the merchant.
 * 2. Buys the cheapest USPS label for the shipment via EasyPost.
 * 3. Emails the merchant a "Download Shipping Label" link via Resend.
 * 4. Persists the order in Postgres via Prisma.
 */
router.post('/create', async (req, res, next) => {
  let order;

  try {
    validateCreateOrderPayload(req.body);
    const { merchantId, customerName, customerEmail, shippingAddress, itemPriceCents } = req.body;

    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new AppError(404, 'Merchant not found');
    if (!merchant.stripeAccountId) {
      throw new AppError(400, 'This merchant has not finished connecting their Stripe account');
    }

    // --- 1. Stripe Connect destination charge -----------------------------
    // We only create the PaymentIntent here; the client (or a follow-up
    // request) confirms it with a real payment method via Stripe.js.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: itemPriceCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      application_fee_amount: PLATFORM_FEE_CENTS,
      transfer_data: { destination: merchant.stripeAccountId },
      metadata: { merchantId, customerEmail, customerName }
    });

    // --- 2. Persist the order up front, before fulfillment ----------------
    order = await prisma.order.create({
      data: {
        merchantId,
        customerName,
        shippingAddress,
        itemPriceCents,
        platformFeeCents: PLATFORM_FEE_CENTS,
        status: 'PENDING'
      }
    });

    // --- 3. EasyPost: create shipment, fetch rates, buy the cheapest ------
    let trackingCode = null;
    let labelUrl = null;

    try {
      const shipment = await easypost.Shipment.create({
        to_address: {
          name: customerName,
          street1: shippingAddress.street1,
          street2: shippingAddress.street2 || undefined,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zip: shippingAddress.zip,
          country: 'US'
        },
        // The merchant's own address, stored at signup, is the ship-from address.
        from_address: merchant.address,
        // Default small-parcel dimensions for the beta; swap for per-product
        // dimensions once products carry their own package specs.
        parcel: {
          length: 9,
          width: 6,
          height: 4,
          weight: 16 // ounces
        }
      });

      const lowestRate = shipment.lowestRate(['USPS']);
      const boughtShipment = await easypost.Shipment.buy(shipment.id, lowestRate);

      trackingCode = boughtShipment.tracking_code;
      labelUrl = boughtShipment.postage_label.label_url;

      order = await prisma.order.update({
        where: { id: order.id },
        data: { status: 'LABEL_PURCHASED', trackingCode, labelUrl }
      });
    } catch (shippingError) {
      console.error('[makerchamp] EasyPost error:', shippingError);
      order = await prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED' }
      });
      throw new AppError(
        502,
        'Your order was recorded, but we could not generate a shipping label. Our team has been notified.'
      );
    }

    // --- 4. Email the merchant with the label ------------------------------
    // A failure here shouldn't fail the whole request — the order and label
    // already exist, so we log and move on.
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'orders@makerchamp.co',
        to: merchant.email,
        subject: `New order from ${customerName} — label ready`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #232019;">
            <h2 style="margin-bottom: 4px;">You've got a new order</h2>
            <p style="margin-top: 0;">${customerName} just checked out on your Makerchamp store.</p>
            <p><strong>Tracking code:</strong> ${trackingCode}</p>
            <p style="margin-top: 24px;">
              <a href="${labelUrl}"
                 style="background:#34493A;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;display:inline-block;">
                Download Shipping Label
              </a>
            </p>
          </div>
        `
      });
    } catch (emailError) {
      console.error('[makerchamp] Resend error:', emailError);
    }

    return res.status(201).json({
      orderId: order.id,
      status: order.status,
      clientSecret: paymentIntent.client_secret,
      trackingCode,
      labelUrl
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
