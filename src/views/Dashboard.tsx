import { useState, useEffect } from 'react';
import { Users, TrendingUp, BookOpen, GraduationCap } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState({
    students: 0,
    teachers: 0,
    classes: 0,
  });

  useEffect(() => {
    // Sinflar — localStorage dan
    try {
      const raw = localStorage.getItem('avto_hisobot_classes');
      const classes: { students: number }[] = raw ? JSON.parse(raw) : [];

      setStats(prev => ({
        ...prev,
        classes: classes.length,
      }));
    } catch {}

    // O'quvchilar va O'qituvchilar — API dan
    Promise.all([
      fetch('/api/data/students').then(r => r.json()),
      fetch('/api/data/teachers').then(r => r.json()),
    ]).then(([students, teachers]) => {
      setStats(prev => ({
        ...prev,
        students: Array.isArray(students) ? students.length : 0,
        teachers: Array.isArray(teachers) ? teachers.length : 0,
      }));
    }).catch(console.error);
  }, []);

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      <h2 className="text-2xl font-semibold text-zinc-900 mb-6">Bosh sahifa (Statistika)</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="Jami o'quvchilar" value={stats.students} icon={<Users className="w-5 h-5" />} trend="+12 bu oy" />
        <StatCard title="O'qituvchilar" value={stats.teachers} icon={<GraduationCap className="w-5 h-5" />} trend="+2 bu oy" />
        <StatCard title="Sinflar" value={stats.classes} icon={<BookOpen className="w-5 h-5" />} trend="0" />
        <StatCard title="O'rtacha davomat" value="94%" icon={<TrendingUp className="w-5 h-5" />} trend="+1.2%" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-medium text-zinc-900 mb-4">So'nggi faolliklar</h3>
          <div className="space-y-4">
            {[
               "9-A sinfda jismoniy tarbiya darsi o'tkazildi",
               "Yangi matematika o'qituvchisi ishga qabul qilindi",
               "11-B sinf o'quvchilari olimpiadada qatnashdi"
            ].map((text, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-900">{text}</p>
                  <p className="text-xs text-zinc-500">{i + 1} soat oldin</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
           <h3 className="text-lg font-medium text-zinc-900 mb-4">E'lonlar</h3>
           <p className="text-sm text-zinc-500">Ertaga barcha sinflarda ota-onalar majlisi bo'lib o'tadi. O'qituvchilar hisobotlarni tayyorlab qo'yishlari so'raladi.</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend }: any) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between hover:border-zinc-300 transition-all">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-zinc-50 rounded-lg text-zinc-600">{icon}</div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${trend === '0' ? 'text-zinc-600 bg-zinc-100' : 'text-emerald-600 bg-emerald-50'}`}>{trend}</span>
      </div>
      <div>
        <h4 className="text-zinc-500 text-sm font-medium">{title}</h4>
        <p className="text-2xl font-bold text-zinc-900">{value}</p>
      </div>
    </div>
  );
}
