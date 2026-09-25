const EasyPostClient = require('@easypost/api');

if (!process.env.EASYPOST_API_KEY) {
  console.warn('[makerchamp] EASYPOST_API_KEY is not set — shipping calls will fail.');
}

const easypost = new EasyPostClient(process.env.EASYPOST_API_KEY);

module.exports = easypost;
