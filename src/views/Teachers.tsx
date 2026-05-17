import { useState, useEffect } from 'react';
import { Phone, Mail, Trash2 } from 'lucide-react';

export default function Teachers() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/data/teachers')
      .then(r => r.json())
      .then(data => {
        setTeachers(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, []);

  const handleAdd = async () => {
    const name = prompt("Yangi o'qituvchining F.I.SH kiriting:");
    if (!name) return;
    const subject = prompt("Qaysi fandan dars beradi? (masalan, Matematika):") || "Noma'lum";
    const phone = prompt("Telefon raqami:") || "+998";
    const exp = prompt("Tajribasi (masalan, 5 yil):") || "0 yil";
    
    const newTeacher = { name, subject, phone, exp };
    
    const res = await fetch('/api/data/teachers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTeacher)
    });
    
    if (res.ok) {
      const saved = await res.json();
      setTeachers([...teachers, saved]);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Haqiqatan ham bu o'qituvchini o'chirmoqchimisiz?")) return;
    
    const res = await fetch(`/api/data/teachers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setTeachers(teachers.filter(t => t.id !== id));
    }
  };

  if (loading) return <div className="py-20 text-center text-zinc-500 font-medium">Ma'lumotlar yuklanmoqda...</div>;

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-zinc-900">O'qituvchilar ro'yxati</h2>
        <button 
          onClick={handleAdd}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors shadow-sm active:scale-95"
        >
          + Yangi qo'shish
        </button>
      </div>

      {teachers.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-zinc-200 text-center text-zinc-500 shadow-sm">
          Hozircha o'qituvchilar yo'q. "Yangi qo'shish" tugmasini bosing.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teachers.map((t) => (
            <div key={t.id} className="bg-white p-6 border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md hover:border-zinc-300 transition-all group relative">
              <button 
                onClick={() => handleDelete(t.id)}
                className="absolute top-4 right-4 p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                title="O'chirish"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 bg-zinc-900 text-white rounded-full flex items-center justify-center text-xl font-medium shadow-sm">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-900 pr-8">{t.name}</h3>
                  <p className="text-sm text-zinc-500">{t.subject} o'qituvchisi</p>
                </div>
              </div>
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 text-sm text-zinc-600">
                  <div className="w-8 h-8 rounded-lg bg-zinc-50 flex items-center justify-center">
                    <Phone className="w-4 h-4 text-zinc-400" />
                  </div>
                  {t.phone}
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-600">
                  <div className="w-8 h-8 rounded-lg bg-zinc-50 flex items-center justify-center">
                    <Mail className="w-4 h-4 text-zinc-400" />
                  </div>
                  {t.name.split(' ')[1]?.toLowerCase() || 'oqituvchi'}@maktab.uz
                </div>
              </div>
              <div className="pt-4 border-t border-zinc-100 flex justify-between items-center">
                <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">Tajriba: {t.exp}</span>
                <button className="text-sm font-medium text-zinc-900 hover:text-zinc-600 transition-colors">Profil</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
