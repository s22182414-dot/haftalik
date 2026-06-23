// npm run dev dan oldin 5173 va 3001 portlarni tozalaydi
import { exec } from 'child_process';
import { promisify } from 'util';

const execP = promisify(exec);

async function killPort(port) {
  try {
    const { stdout } = await execP(
      `netstat -ano | findstr :${port} | findstr LISTENING`
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') {
        try {
          await execP(`taskkill /PID ${pid} /F`);
          console.log(`✅ Port ${port} tozalandi (PID: ${pid})`);
        } catch {
          // allaqachon to'xtagan bo'lishi mumkin
        }
      }
    }
  } catch {
    // port band emas — hech narsa qilmaydi
  }
}

console.log('🔄 Portlar tekshirilmoqda...');
await killPort(5173);
await killPort(3001);
console.log('✅ Tayyor! Serverlar ishga tushmoqda...\n');
