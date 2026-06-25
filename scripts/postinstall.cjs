const { execSync } = require('child_process');

try {
  console.log('[Postinstall] Starting Puppeteer Chrome installation...');
  process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'false';
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
  console.log('[Postinstall] Puppeteer Chrome installed successfully.');
} catch (e) {
  console.warn('[Postinstall] WARNING: Puppeteer Chrome installation failed:', e.message);
}
