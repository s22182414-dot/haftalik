import { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, Play, Database, Send, ShieldCheck, ArrowRight, 
  KeyRound, LogIn, UserCheck, UserX, Smartphone, Loader2, LogOut, 
  Globe, RefreshCw, AlertCircle
} from 'lucide-react';

export default function Reports() {
  const [config, setConfig] = useState({ googleConnected: false, isTelegramConfigured: false, authMode: '' });
  const [triggering, setTriggering] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [sendingAllImages, setSendingAllImages] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | null }>({ message: '', type: null });

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

  const fetchConfig = () => {
    fetch('/api/config').then(r => r.json()).then(setConfig).catch(console.error);
  };

  const fetchUserbotStatus = () => {
    fetch('/api/userbot/status')
      .then(r => r.json())
      .then(setUserbotStatus)
      .catch(console.error);
  };

  useEffect(() => {
    fetchConfig();
    fetchUserbotStatus();
    
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

  // Userbot handlers
  const handleUserbotConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiId || !apiHash || !phoneNumber) {
      showNotify("Barcha maydonlarni to'ldiring.", 'error');
      return;
    }
    setUserbotLoading(true);
    try {
      const res = await fetch('/api/userbot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId, apiHash, phoneNumber })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showNotify(data.message, 'success');
        setUserbotStep(2);
      } else {
        showNotify(data.error || "Ulanishda xatolik yuz berdi.", 'error');
      }
    } catch {
      showNotify("Serverga ulanishda xatolik yuz berdi.", 'error');
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
      const res = await fetch('/api/userbot/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: smsCode, password: twoFactorPassword })
      });
      const data = await res.json();
      if (res.ok) {
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
      } else {
        showNotify(data.error || "Tasdiqlashda xatolik yuz berdi.", 'error');
      }
    } catch {
      showNotify("Serverga ulanishda xatolik yuz berdi.", 'error');
    } finally {
      setUserbotLoading(false);
    }
  };

  const handleUserbotDisconnect = async () => {
    if (!confirm("Haqiqatan ham Telegram profilingizni uzmoqchimisiz?")) return;
    setUserbotLoading(true);
    try {
      const res = await fetch('/api/userbot/disconnect', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showNotify(data.message, 'success');
        fetchUserbotStatus();
      } else {
        showNotify(data.error || "Ulanishni uzishda xatolik yuz berdi.", 'error');
      }
    } catch {
      showNotify("Serverga ulanishda xatolik yuz berdi.", 'error');
    } finally {
      setUserbotLoading(false);
    }
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

            <div>
              {config.googleConnected ? (
                <button
                  onClick={handleConnectGoogle}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-3 px-4 rounded-xl text-sm font-medium transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Qayta bog'lash (Hisobni almashtirish)
                </button>
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
