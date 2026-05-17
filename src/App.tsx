import { Activity } from 'lucide-react';
import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';

import Reports from './views/Reports';

export default function App() {
  const location = useLocation();

  useEffect(() => {
    const checkWeeklyReset = async () => {
      try {
        const today = new Date();
        // Yakshanba kuni (0 = Sunday) tekshiruvi
        if (today.getDay() === 0) {
          const dateStr = today.toISOString().split('T')[0];
          const lastReset = localStorage.getItem('avto_hisobot_last_reset');
          
          if (lastReset !== dateStr) {
            console.log('Yakshanba tozalanishi ishga tushdi! Barcha baholar 0.0 ga qaytarilmoqda...');
            const res = await fetch('/api/data/reset-gpa', { method: 'POST' });
            if (res.ok) {
              localStorage.setItem('avto_hisobot_last_reset', dateStr);
              console.log('Tozalash tugatildi!');
              window.location.reload();
            }
          }
        }
      } catch (err) {
        console.error('Haftalik tozalashda xatolik:', err);
      }
    };
    checkWeeklyReset();
  }, []);

  return (
    <div className="flex min-h-screen bg-[#FAFAFA] text-zinc-900 font-sans selection:bg-zinc-200">
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Navbar */}
        <nav className="border-b border-zinc-200 bg-white sticky top-0 z-10">
          <div className="max-w-5xl mx-auto w-full px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-zinc-900 rounded-md flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-sm tracking-tight">Maktab tizimi - Hisobotlar</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-zinc-100 rounded-full border border-zinc-200">
                <div className="w-1.5 h-1.5 bg-zinc-900 rounded-full animate-pulse" />
                <span className="text-[11px] font-medium text-zinc-600 uppercase tracking-widest">Tizim faol</span>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-5xl mx-auto w-full px-6 py-12 md:py-20">
          <Routes>
            <Route path="*" element={<Reports />} />
          </Routes>
        </main>

        <footer className="border-t border-zinc-200 mt-auto">
          <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">© 2026 Maktab Tizimi</p>
            <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">v1.1.0 premium</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

