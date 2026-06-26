const { execSync } = require('child_process');

// Docker muhitida PUPPETEER_EXECUTABLE_PATH o'rnatilgan bo'ladi
// (system chromium ishlatiladi) — shuning uchun yuklab olish shart emas
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  console.log('[Postinstall] Docker muhiti aniqlandi (PUPPETEER_EXECUTABLE_PATH=' + process.env.PUPPETEER_EXECUTABLE_PATH + '). Chrome yuklab olish o\'tkazib yuborildi.');
} else {
  try {
    console.log('[Postinstall] Render muhiti — Puppeteer Chrome yuklab olinmoqda...');
    execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
    console.log('[Postinstall] Puppeteer Chrome muvaffaqiyatli o\'rnatildi.');
  } catch (e) {
    console.warn('[Postinstall] OGOHLANTIRISH: Chrome yuklab olishda xatolik yuz berdi:', e.message);
  }
}
