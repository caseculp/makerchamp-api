require('dotenv').config();

const express = require('express');
const cors = require('cors');

const ordersRouter = require('./routes/orders');
const AppError = require('./lib/AppError');

const app = express();

// Open CORS for now — this is fine for the public beta demo widget,
// but should be locked down to known merchant domains before launch.
app.use(cors({ origin: '*' }));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/orders', ordersRouter);

// 404 for anything else
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler. AppError instances carry a safe public
// message; anything else is logged and reported generically.
app.use((err, req, res, next) => {
  if (!(err instanceof AppError)) {
    console.error('[makerchamp] Unhandled error:', err);
  }

  const statusCode = err.statusCode || 500;
  const publicMessage = err.publicMessage || 'Something went wrong. Please try again.';

  res.status(statusCode).json({ error: publicMessage });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Makerchamp API listening on port ${PORT}`);
});
