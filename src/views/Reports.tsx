import { useState, useEffect } from 'react';
import { FileSpreadsheet, Play, Database, Send, ShieldCheck, ArrowRight, KeyRound, LogIn } from 'lucide-react';

export default function Reports() {
  const [config, setConfig] = useState({ googleConnected: false, isTelegramConfigured: false, authMode: '' });
  const [triggering, setTriggering] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [sendingAllImages, setSendingAllImages] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | null }>({ message: '', type: null });

  const fetchConfig = () => {
    fetch('/api/config').then(r => r.json()).then(setConfig).catch(console.error);
  };

  useEffect(() => {
    fetchConfig();
    
    // Listen for message from auth popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'google-auth-success') {
        showNotify("Google Drive muvaffaqiyatli bog'landi!", 'success');
        fetchConfig();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const showNotify = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification({ message: '', type: null }), 5000);
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const d = await (await fetch('/api/trigger', { method: 'POST' })).json();
      if (d.success) {
        showNotify("Muvaffaqiyatli bajarildi! Telegramni tekshiring.", 'success');
      } else {
        showNotify("Xatolik: " + d.error, 'error');
      }
    } catch { 
      showNotify("So'rov yuborishda xatolik yuz berdi.", 'error'); 
    }
    finally { setTriggering(false); }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const d = await (await fetch('/api/analyze', { method: 'POST' })).json();
      if (d.success) {
        showNotify("AI Tahlil boshlandi! Telegram botga tez orada tahlil xabari boradi.", 'success');
      } else {
        showNotify("Xatolik: " + d.error, 'error');
      }
    } catch { 
      showNotify("So'rov yuborishda xatolik yuz berdi.", 'error'); 
    }
    finally { setAnalyzing(false); }
  };

  const handleSendAllImages = async () => {
    setSendingAllImages(true);
    try {
      const d = await (await fetch('/api/send-all-images', { method: 'POST' })).json();
      if (d.success) {
        showNotify("Barcha 24 sinf rasmlari yuborilmoqda! Server terminalini kuzating.", 'success');
      } else {
        showNotify("Xatolik: " + d.error, 'error');
      }
    } catch { 
      showNotify("So'rov yuborishda xatolik yuz berdi.", 'error'); 
    }
    finally { setSendingAllImages(false); }
  };

  const handleConnectGoogle = () => {
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open('/api/auth/google', 'google-auth', `width=${width},height=${height},left=${left},top=${top}`);
  };

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300 relative">
        {/* Custom Notification */}
        {notification.type && (
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none p-4">
            <div className={`
              animate-in zoom-in-95 slide-in-from-bottom-4 duration-300
              max-w-md w-full bg-white border shadow-2xl rounded-2xl p-6 flex items-center gap-4 pointer-events-auto
              ${notification.type === 'success' ? 'border-emerald-100' : 'border-red-100'}
            `}>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                notification.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
              }`}>
                {notification.type === 'success' ? <ShieldCheck className="w-6 h-6" /> : <Database className="w-6 h-6" />}
              </div>
              <div className="flex-1">
                <h4 className={`text-sm font-semibold mb-1 ${notification.type === 'success' ? 'text-emerald-900' : 'text-red-900'}`}>
                  {notification.type === 'success' ? 'Muvaffaqiyatli' : 'Xatolik yuz berdi'}
                </h4>
                <p className="text-zinc-500 text-xs leading-relaxed">{notification.message}</p>
              </div>
              <button 
                onClick={() => setNotification({ message: '', type: null })}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <LogIn className="w-4 h-4 rotate-90" />
              </button>
            </div>
          </div>
        )}

        {/* Header / Hero */}
        <header className="mb-16 max-w-2xl">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900 mb-4">
            Haftalik hisobotlar avtomatizatsiyasi.
          </h1>
          <p className="text-zinc-500 text-sm md:text-base leading-relaxed">
            Google Drive tizimidagi ma'lumotlarni yig'ish, Gemini AI yordamida 16 xil yo'nalishda tahlil qilish va 16 varaqli Excel hisobotini Telegram orqali yuborish tizimi.
          </p>
        </header>

        {/* Primary Action */}
        <div className="mb-16 p-6 md:p-8 bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:shadow-md transition-shadow">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 mb-1">Qo'lda ishga tushirish</h2>
            <p className="text-sm text-zinc-500">Hisobot amallarini jadvaldan tashqari zudlik bilan ishga tushirish.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <button 
              onClick={handleTrigger} 
              disabled={triggering || !config.googleConnected}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-zinc-900 text-white px-5 py-3 rounded-xl text-sm font-medium transition-all hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {triggering ? "Tozalanmoqda..." : "Juma: Tozalash"}
              <Play className="w-4 h-4 fill-current" />
            </button>
            <button 
              onClick={handleAnalyze} 
              disabled={analyzing || !config.googleConnected}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-xl text-sm font-medium transition-all hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {analyzing ? "AI Tahlil..." : "Shanba: AI Tahlil"}
              <ShieldCheck className="w-4 h-4" />
            </button>
            <button 
              onClick={handleSendAllImages} 
              disabled={sendingAllImages || !config.googleConnected}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-medium transition-all hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {sendingAllImages ? "Yuborilmoqda..." : "Barcha sinflar (24 ta)"}
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

    </div>
  );
}
