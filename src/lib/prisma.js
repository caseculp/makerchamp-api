const { PrismaClient } = require('@prisma/client');

// Reuse a single PrismaClient instance across the app instead of
// instantiating one per request.
const prisma = new PrismaClient();

module.exports = prisma;
