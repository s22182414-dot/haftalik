import { useState, useEffect } from 'react';
import { Search, Filter, Trash2, Trophy } from 'lucide-react';

export default function Students() {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/data/students')
      .then(r => r.json())
      .then(data => {
        setStudents(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, []);

  const handleAdd = async () => {
    const name = prompt("Yangi o'quvchining F.I.SH kiriting:");
    if (!name) return;
    const grade = prompt("Qaysi sinfda o'qiydi? (masalan, 9-A):") || "Noma'lum";
    const gpa = prompt("O'rtacha bahosi qanday? (masalan, 4.5):") || "0.0";
    
    const newStudent = { name, grade, gpa, status: 'Faol' };
    
    const res = await fetch('/api/data/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newStudent)
    });
    
    if (res.ok) {
      const saved = await res.json();
      setStudents([...students, saved]);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Haqiqatan ham bu o'quvchini o'chirmoqchimisiz?")) return;
    
    const res = await fetch(`/api/data/students/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setStudents(students.filter(s => s.id !== id));
    }
  };

  if (loading) return <div className="py-20 text-center text-zinc-500 font-medium">Ma'lumotlar yuklanmoqda...</div>;

  // Calculate ranks for students based on their class
  // Calculate ranks for students based on their class
  const studentsWithRanks = students.map(student => {
    const classMates = students.filter(s => s.grade === student.grade);
    classMates.sort((a, b) => parseFloat(b.gpa || "0") - parseFloat(a.gpa || "0"));
    const rank = classMates.findIndex(s => s.id === student.id) + 1;
    return { ...student, rank, isLast: rank === classMates.length };
  });

  const classNames = Array.from(new Set(studentsWithRanks.map(s => s.grade)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">Sinf peshqadamlari va qoloqlari</h2>
          <p className="text-sm text-zinc-500 mt-1">Har bir sinf bo'yicha eng yuqori va eng past ko'rsatkichlar</p>
        </div>
        <button 
          onClick={handleAdd}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors shadow-sm active:scale-95"
        >
          + Yangi qo'shish
        </button>
      </div>

      {classNames.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-12 text-center">
          <p className="text-zinc-500">O'quvchilar topilmadi.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {classNames.map(className => {
            const classMates = studentsWithRanks.filter(s => s.grade === className);
            const topStudent = classMates.find(s => s.rank === 1);
            const bottomStudent = classMates.find(s => s.isLast && s.rank !== 1);

            return (
              <div key={className} className="bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                <div className="p-4 border-b border-zinc-200 bg-zinc-50/80 flex items-center justify-between">
                  <h3 className="font-bold text-zinc-900 text-lg flex items-center gap-2">
                    {className} <span className="text-sm font-medium text-zinc-500">sinfi</span>
                  </h3>
                  <span className="text-xs font-bold text-zinc-600 bg-zinc-200/50 px-2.5 py-1 rounded-md">
                    {classMates.length} o'quvchi
                  </span>
                </div>
                
                <div className="p-5 flex flex-col gap-4 bg-white flex-1">
                  {/* Top Student */}
                  {topStudent ? (
                    <div className="flex items-start gap-4 p-4 bg-linear-to-br from-yellow-50 to-amber-50/30 rounded-xl border border-yellow-200/60 shadow-sm relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:rotate-12 group-hover:scale-110 duration-300">
                        <Trophy className="w-16 h-16 text-yellow-600" />
                      </div>
                      <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm z-10">
                        <Trophy className="w-5 h-5 text-yellow-600" />
                      </div>
                      <div className="relative z-10">
                        <p className="text-[10px] font-black text-yellow-800 mb-1 uppercase tracking-widest bg-yellow-100/80 inline-block px-2 py-0.5 rounded">1-O'rin</p>
                        <p className="font-bold text-zinc-900 text-base">{topStudent.name}</p>
                        <p className="text-xs font-semibold text-yellow-700 mt-1">
                          Baho: <span className="text-yellow-800 bg-yellow-100/50 px-1.5 py-0.5 rounded ml-1">{topStudent.gpa}</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-400 italic p-4 text-center bg-zinc-50 rounded-xl border border-zinc-100">1-o'rin aniqlanmadi</div>
                  )}

                  {/* Bottom Student */}
                  {bottomStudent ? (
                    <div className="flex items-start gap-4 p-4 bg-linear-to-br from-red-50 to-rose-50/30 rounded-xl border border-red-100 shadow-sm relative overflow-hidden group">
                      <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm z-10">
                        <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                      </div>
                      <div className="relative z-10">
                        <p className="text-[10px] font-black text-red-600 mb-1 uppercase tracking-widest bg-red-100/80 inline-block px-2 py-0.5 rounded">Eng past natija</p>
                        <p className="font-bold text-zinc-900 text-base">{bottomStudent.name}</p>
                        <p className="text-xs font-semibold text-red-600 mt-1">
                          Baho: <span className="text-red-700 bg-red-100/50 px-1.5 py-0.5 rounded ml-1">{bottomStudent.gpa}</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-400 italic p-4 text-center bg-zinc-50 rounded-xl border border-zinc-100">Qoloq o'quvchi aniqlanmadi</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
