import { useState, useEffect, useRef } from 'react';
import { 
  FileSpreadsheet, Play, Database, Send, ShieldCheck, ArrowRight, 
  KeyRound, LogIn, UserCheck, UserX, Smartphone, Loader2, LogOut, 
  Globe, RefreshCw, AlertCircle, Terminal, Trash2, Wifi, WifiOff
} from 'lucide-react';

export default function Reports() {
  const [config, setConfig] = useState({ googleConnected: false, isTelegramConfigured: false, authMode: '' });
  const [triggering, setTriggering] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [sendingAllImages, setSendingAllImages] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | null }>({ message: '', type: null });
  const [backendLoading, setBackendLoading] = useState(true);

  // Server log panel
  type LogEntry = { level: 'info' | 'warn' | 'error'; msg: string; ts: string };
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logConnected, setLogConnected] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Userbot State Variables
  const [userbotStatus, setUserbotStatus] = useState<{ connected: boolean; phoneNumber?: string; apiId?: string }>({ connected: false });
  const [userbotLoading, setUserbotLoading] = useState(false);
  const [userbotStep, setUserbotStep] = useState<1 | 2>(1);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);

  const safeFetch = async (url: string, options?: RequestInit) => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const text = await res.text();
        console.error(`[API ERROR] ${url} returned status ${res.status}:`, text);
        throw new Error(`Server status ${res.status}: ${text.slice(0, 300)}`);
      }
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error(`[API ERROR] Non-JSON response for ${url}:`, text);
        throw new Error(`Non-JSON response: ${text.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err: any) {
      console.error(`[API FETCH FAILED] ${url}:`, err.message || err);
      throw err;
    }
  };

  const fetchConfig = async () => {
    try {
      const data = await safeFetch('/api/config');
      setConfig(data);
      setBackendLoading(false);
    } catch (err) {
      console.error("Config yuklashda xato, qayta urinib ko'rilmoqda:", err);
      setTimeout(fetchConfig, 3000);
    }
  };

  const fetchUserbotStatus = async () => {
    try {
      const data = await safeFetch('/api/userbot/status');
      setUserbotStatus(data);
    } catch (err) {
      console.error("Userbot status yuklashda xato:", err);
    }
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

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    if (backendLoading) return;

    fetchUserbotStatus();

    let sse: EventSource | null = null;
    let reconnectTimer: any = null;
    let destroyed = false;
    let retryDelay = 3000; // boshlang'ich: 3 soniya

    const connectSSE = () => {
      if (destroyed) return;
      sse = new EventSource('/api/logs');
      sseRef.current = sse;

      sse.onopen = () => {
        setLogConnected(true);
        retryDelay = 3000; // muvaffaqiyatli ulanganda — qayta boshlash
        console.log('[SSE] Server log oqimiga ulandi.');
      };

      sse.onerror = () => {
        setLogConnected(false);
        sse?.close();
        if (!destroyed) {
          console.warn(`[SSE] Ulanish uzildi. ${retryDelay / 1000}s dan keyin qayta uriniladi...`);
          reconnectTimer = setTimeout(connectSSE, retryDelay);
          // Exponential backoff: har safar ikki baravar, max 30 soniya
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      };

      sse.onmessage = (e) => {
        try {
          const entry: LogEntry = JSON.parse(e.data);
          setLogs(prev => [...prev.slice(-499), entry]);
          const prefix = `[Server ${entry.level.toUpperCase()}]`;
          if (entry.level === 'error') console.error(prefix, entry.msg);
          else if (entry.level === 'warn') console.warn(prefix, entry.msg);
          else console.log(prefix, entry.msg);
        } catch {}
      };
    };

    connectSSE();

    // Serverni uxlab qolishdan saqlash uchun har 10 daqiqada ping
    const interval = setInterval(() => {
      safeFetch('/api/config').catch(() => {});
    }, 10 * 60 * 1000);

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      clearInterval(interval);
      if (sse) sse.close();
    };
  }, [backendLoading]);

  const showNotify = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification({ message: '', type: null }), 5000);
  };

  // Auto-scroll log panel
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleTrigger = async () => {
    console.log('[Reports] Triggering Juma: Tozalash...');
    setTriggering(true);
    try {
      const d = await safeFetch('/api/trigger', { method: 'POST' });
      console.log('[Reports] Trigger response:', d);
      if (d.success) {
        showNotify("Muvaffaqiyatli bajarildi! Telegramni tekshiring.", 'success');
      } else {
        showNotify("Xatolik: " + d.error, 'error');
      }
    } catch (err: any) { 
      console.error('[Reports] Trigger request failed:', err);
      showNotify("So'rov yuborishda xatolik yuz berdi: " + err.message, 'error'); 
    }
    finally { setTriggering(false); }
  };

  const handleAnalyze = async () => {
    console.log('[Reports] Triggering Shanba: AI Tahlil...');
    setAnalyzing(true);
    try {
      const d = await safeFetch('/api/analyze', { method: 'POST' });
      console.log('[Reports] AI Tahlil response:', d);
      if (d.success) {
        showNotify("AI Tahlil boshlandi! Telegram botga tez orada tahlil xabari boradi.", 'success');
      } else {
        showNotify("Xatolik: " + d.error, 'error');
      }
    } catch (err: any) { 
      console.error('[Reports] AI Tahlil request failed:', err);
      showNotify("So'rov yuborishda xatolik yuz berdi: " + err.message, 'error'); 
    }
    finally { setAnalyzing(false); }
  };

  const handleSendAllImages = async () => {
    console.log('[Reports] Triggering Barcha sinflar (24 ta)...');
    setSendingAllImages(true);
    try {
      const d = await safeFetch('/api/send-all-images', { method: 'POST' });
      console.log('[Reports] Send all images response:', d);
      if (d.success) {
        showNotify("Barcha 24 sinf rasmlari yuborilmoqda! Server terminalini kuzating.", 'success');
      } else {
        showNotify("Xatolik: " + d.error, 'error');
      }
    } catch (err: any) { 
      console.error('[Reports] Send all images request failed:', err);
      showNotify("So'rov yuborishda xatolik yuz berdi: " + err.message, 'error'); 
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

  const handleDisconnectGoogle = async () => {
    if (!window.confirm("Google Drive ulanishini uzmoqchimisiz?")) return;
    try {
      await safeFetch('/api/auth/google/disconnect', { method: 'POST' });
      showNotify("Google Drive ulanishi uzildi.", 'success');
      fetchConfig();
    } catch (err: any) {
      showNotify("Uzishda xatolik: " + err.message, 'error');
    }
  };

  // Userbot handlers
  const handleUserbotConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiId || !apiHash || !phoneNumber) {
      showNotify("Barcha maydonlarni to'ldiring.", 'error');
      return;
    }
    setUserbotLoading(true);
    try {
      const data = await safeFetch('/api/userbot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId, apiHash, phoneNumber })
      });
      if (data.success) {
        showNotify(data.message, 'success');
        setUserbotStep(2);
      } else {
        showNotify(data.error || "Ulanishda xatolik yuz berdi.", 'error');
      }
    } catch (err: any) {
      showNotify("Serverga ulanishda xatolik yuz berdi: " + err.message, 'error');
    } finally {
      setUserbotLoading(false);
    }
  };

  const handleUserbotVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsCode) {
      showNotify("Tasdiqlash kodini kiriting.", 'error');
      return;
    }
    setUserbotLoading(true);
    try {
      const data = await safeFetch('/api/userbot/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: smsCode, password: twoFactorPassword })
      });
      if (data.success) {
        showNotify(data.message, 'success');
        setUserbotStep(1);
        setSmsCode('');
        setTwoFactorPassword('');
        setPasswordRequired(false);
        fetchUserbotStatus();
      } else if (data.passwordRequired) {
        showNotify(data.message, 'success');
        setPasswordRequired(true);
      } else {
        showNotify(data.message || data.error || "Kod noto'g'ri.", 'error');
      }
    } catch (err: any) {
      showNotify("Serverga ulanishda xatolik yuz berdi: " + err.message, 'error');
    } finally {
      setUserbotLoading(false);
    }
  };

  const handleUserbotDisconnect = async () => {
    if (!confirm("Haqiqatan ham Telegram profilingizni uzmoqchimisiz?")) return;
    setUserbotLoading(true);
    try {
      const data = await safeFetch('/api/userbot/disconnect', { method: 'POST' });
      if (data.success) {
        showNotify(data.message, 'success');
        fetchUserbotStatus();
      } else {
        showNotify(data.error || "Ulanishni uzishda xatolik yuz berdi.", 'error');
      }
    } catch (err: any) {
      showNotify("Serverga ulanishda xatolik yuz berdi: " + err.message, 'error');
    } finally {
      setUserbotLoading(false);
    }
  };

  if (backendLoading) {
    return (
      <div className="fixed inset-0 bg-[#0d1117]/90 backdrop-blur-md flex flex-col items-center justify-center z-50 p-6 text-center animate-in fade-in duration-300">
        <div className="max-w-md w-full bg-[#161b22] border border-zinc-800 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-zinc-850 border-t-emerald-500 rounded-full animate-spin" />
            <Terminal className="w-6 h-6 text-zinc-400 absolute inset-0 m-auto animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2 font-mono">Server uygonyapti...</h3>
            <p className="text-zinc-400 text-xs leading-relaxed font-sans mb-4">
              Render bepul serveri 15 daqiqa davomida ishlatilmagani uchun avtomatik uxlab qolgan. Hozir u qayta ishga tushmoqda, bu taxminan 30-50 soniya vaqt oladi.
            </p>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 text-left">
              <span className="text-[10px] font-mono text-amber-500 uppercase font-bold block mb-1">💡 Foydali maslahat</span>
              <p className="text-zinc-550 text-[11px] leading-normal font-sans">
                Server umuman uxlab qolmasligi va bir zumda yuklanishi uchun <a href="https://uptimerobot.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300">uptimerobot.com</a> yoki <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300">cron-job.org</a> orqali <code>https://haftalikd.onrender.com/api/config</code> manzilini har 10 daqiqada tekshiradigan bepul ping sozlab qo'yishingiz mumkin.
              </p>
            </div>
          </div>
          <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full animate-loading-progress" />
          </div>
          <p className="text-zinc-500 text-[10px] font-mono tracking-widest uppercase animate-pulse">Iltimos, kutib turing...</p>
        </div>
      </div>
    );
  }

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
        <header className="mb-12 max-w-2xl">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900 mb-4">
            Haftalik hisobotlar avtomatizatsiyasi.
          </h1>
          <p className="text-zinc-500 text-sm md:text-base leading-relaxed">
            Google Drive tizimidagi ma'lumotlarni yig'ish, Gemini AI yordamida 16 xil yo'nalishda tahlil qilish va 16 varaqli Excel hisobotini Telegram orqali yuborish tizimi.
          </p>
        </header>

        {/* Primary Action */}
        <div className="mb-12 p-6 md:p-8 bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:shadow-md transition-shadow">
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

        {/* Real-time Server Log Panel */}
        <div className="mb-10 rounded-2xl overflow-hidden border border-zinc-800 shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-900">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-mono font-medium text-zinc-300">Server Log</span>
              <div className="flex items-center gap-1.5 ml-2">
                {logConnected ? (
                  <><Wifi className="w-3 h-3 text-emerald-400" />
                  <span className="text-[11px] text-emerald-400 font-mono">ulandi</span></>
                ) : (
                  <><WifiOff className="w-3 h-3 text-zinc-500" />
                  <span className="text-[11px] text-zinc-500 font-mono">uzildi</span></>
                )}
              </div>
            </div>
            <button
              onClick={() => setLogs([])}
              className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors text-xs font-mono px-2 py-1 rounded hover:bg-zinc-800"
            >
              <Trash2 className="w-3 h-3" />
              tozalash
            </button>
          </div>
          {/* Log output */}
          <div className="bg-[#0d1117] h-72 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
            {logs.length === 0 ? (
              <div className="text-zinc-600 italic">Tugmalardan birini bosing — server loglari shu yerda ko'rinadi...</div>
            ) : (
              logs.map((entry, i) => {
                const time = new Date(entry.ts).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const color = entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-yellow-300' : 'text-emerald-400';
                const prefix = entry.level === 'error' ? '✗' : entry.level === 'warn' ? '⚠' : '›';
                return (
                  <div key={i} className="flex gap-2 mb-0.5 group">
                    <span className="text-zinc-600 shrink-0 select-none">{time}</span>
                    <span className={`${color} shrink-0`}>{prefix}</span>
                    <span className={entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-yellow-200' : 'text-zinc-200'}
                      style={{ wordBreak: 'break-all' }}>
                      {entry.msg}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Integration Settings Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
          
          {/* Google Drive Card */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                  <Globe className="w-6 h-6" />
                </div>
                {config.googleConnected ? (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-full">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Bog'langan
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-zinc-100 border border-zinc-200 text-zinc-600 text-xs font-semibold rounded-full">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Bog'lanmagan
                  </span>
                )}
              </div>

              <h3 className="text-lg font-semibold text-zinc-900 mb-2">Google Drive integratsiyasi</h3>
              <p className="text-zinc-500 text-sm leading-relaxed mb-6">
                Excel hisobotlaridagi baholar va ma'lumotlarni o'qish hamda yangilash uchun Google Drive xizmatiga ulanish talab etiladi.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {config.googleConnected ? (
                <>
                  <button
                    onClick={handleConnectGoogle}
                    className="w-full flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-3 px-4 rounded-xl text-sm font-medium transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Qayta bog'lash (Hisobni almashtirish)
                  </button>
                  <button
                    onClick={handleDisconnectGoogle}
                    className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Ulanishni uzish
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnectGoogle}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-xl text-sm font-medium transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  Google hisobini ulash
                </button>
              )}
            </div>
          </div>

          {/* Telegram Userbot Card */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                  <Smartphone className="w-6 h-6" />
                </div>
                {userbotStatus.connected ? (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-full">
                    <UserCheck className="w-3.5 h-3.5" />
                    Profil faol
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-zinc-100 border border-zinc-200 text-zinc-600 text-xs font-semibold rounded-full">
                    <UserX className="w-3.5 h-3.5" />
                    Ulanmagan
                  </span>
                )}
              </div>

              <h3 className="text-lg font-semibold text-zinc-900 mb-2">Telegram shaxsiy profil (Userbot)</h3>
              <p className="text-zinc-500 text-sm leading-relaxed mb-6">
                Xabarlar, Excel havolalari (preview bilan) va sinf rasmlari shaxsiy Telegram profilingizdan guruhlarga yuboriladi. Ulanmagan bo'lsa, Telegram Bot orqali yuboriladi.
              </p>

              {userbotStatus.connected ? (
                // Connected info UI
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 mb-6 space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Ulangan raqam:</span>
                    <span className="font-semibold text-zinc-800">{userbotStatus.phoneNumber}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">API ID:</span>
                    <span className="font-mono text-zinc-800">{userbotStatus.apiId}</span>
                  </div>
                </div>
              ) : (
                // Setup Form UI
                <div>
                  {userbotStep === 1 ? (
                    <form onSubmit={handleUserbotConnect} className="space-y-4 mb-6">
                      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-xs leading-relaxed">
                        <strong>API ID va API Hash olish uchun:</strong>
                        <ol className="list-decimal list-inside mt-1 space-y-0.5">
                          <li><a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="underline font-semibold hover:text-amber-800">my.telegram.org</a> saytiga kiring.</li>
                          <li>Tizimga kirib, <strong>API development tools</strong> bo'limida yangi ilova yarating.</li>
                          <li>App <code>api_id</code> va <code>api_hash</code> ma'lumotlarini pastga kiriting.</li>
                        </ol>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1.5">API ID</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. 2192831"
                            value={apiId}
                            onChange={e => setApiId(e.target.value)}
                            disabled={userbotLoading}
                            className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:bg-white rounded-xl px-3 py-2 text-sm transition-colors outline-none disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1.5">API Hash</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. ab3c89..."
                            value={apiHash}
                            onChange={e => setApiHash(e.target.value)}
                            disabled={userbotLoading}
                            className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:bg-white rounded-xl px-3 py-2 text-sm transition-colors outline-none disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1.5">Telefon raqam</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. +998901234567"
                          value={phoneNumber}
                          onChange={e => setPhoneNumber(e.target.value)}
                          disabled={userbotLoading}
                          className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:bg-white rounded-xl px-3 py-2 text-sm transition-colors outline-none disabled:opacity-50"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={userbotLoading}
                        className="w-full flex items-center justify-center gap-2 bg-zinc-950 hover:bg-zinc-800 text-white py-2.5 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {userbotLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Kod yuborilmoqda...
                          </>
                        ) : (
                          <>
                            <ArrowRight className="w-4 h-4" />
                            Ulanish kodini olish
                          </>
                        )}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleUserbotVerify} className="space-y-4 mb-6">
                      <div className="bg-zinc-50 border border-zinc-200 text-zinc-600 rounded-xl p-4 text-xs leading-relaxed">
                        Telegram orqali kelgan 5 xonali tasdiqlash kodini kiriting. Raqamingiz: <strong>{phoneNumber}</strong>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1.5">Tasdiqlash kodi</label>
                        <input
                          type="text"
                          required
                          placeholder="Telegram SMS/Kodi"
                          value={smsCode}
                          onChange={e => setSmsCode(e.target.value)}
                          disabled={userbotLoading}
                          className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:bg-white rounded-xl px-3 py-2 text-sm transition-colors outline-none disabled:opacity-50"
                        />
                      </div>

                      {passwordRequired && (
                        <div>
                          <label className="block text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1.5">2FA Parol</label>
                          <input
                            type="password"
                            placeholder="2-bosqichli parol"
                            value={twoFactorPassword}
                            onChange={e => setTwoFactorPassword(e.target.value)}
                            disabled={userbotLoading}
                            className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:bg-white rounded-xl px-3 py-2 text-sm transition-colors outline-none disabled:opacity-50"
                          />
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setUserbotStep(1); setSmsCode(''); setTwoFactorPassword(''); setPasswordRequired(false); }}
                          disabled={userbotLoading}
                          className="flex-1 border border-zinc-200 hover:bg-zinc-50 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 text-center text-zinc-700"
                        >
                          Orqaga
                        </button>
                        <button
                          type="submit"
                          disabled={userbotLoading}
                          className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {userbotLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Tasdiqlanmoqda...
                            </>
                          ) : (
                            <>
                              <KeyRound className="w-4 h-4" />
                              Ulashni yakunlash
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>

            <div>
              {userbotStatus.connected && (
                <button
                  onClick={handleUserbotDisconnect}
                  disabled={userbotLoading}
                  className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 py-3 px-4 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {userbotLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4" />
                  )}
                  Profilingizni uzish (Disconnect)
                </button>
              )}
            </div>
          </div>

        </div>

    </div>
  );
}
