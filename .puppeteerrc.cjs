const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Save Chrome inside the project folder so it gets deployed to the runtime instance
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
