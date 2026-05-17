import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, DoorOpen, GraduationCap, X, Check, ArrowLeft, Trash2, Plus, Upload, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ClassItem {
  id: string;
  name: string;
  color: 'blue' | 'green';
  teacher: string;
  students: number;
  room: string;
}

const LS_KEY = 'avto_hisobot_classes';

function isTib(c: ClassItem): boolean {
  return c.name.toLowerCase().includes('tib');
}

function isGreen(c: ClassItem): boolean {
  if (isTib(c)) return false;
  return c.color === 'green' || c.name.toLowerCase().endsWith('g');
}

function formatClassName(name: string): string {
  const match = name.match(/^(\d+)(.*)/);
  if (!match) return name.toUpperCase();
  const num = match[1];
  const suffix = match[2] ? match[2].toUpperCase() : '';
  return suffix ? `${num}-${suffix}` : num;
}

export default function ClassDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [classItem, setClassItem] = useState<ClassItem | null>(null);
  const [studentsList, setStudentsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newLastName, setNewLastName] = useState('');
  const [newFirstName, setNewFirstName] = useState('');

  useEffect(() => {
    // 1. Sinfni localStorage dan o'qish
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const classes = JSON.parse(raw) as ClassItem[];
        const found = classes.find(c => c.id === id);
        if (found) {
          setClassItem(found);
        }
      }
    } catch {}

    // 2. O'quvchilarni API dan o'qish
    fetch('/api/data/students')
      .then(r => r.json())
      .then(data => {
        setStudentsList(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const persistChange = (field: keyof ClassItem, value: string | number) => {
    if (!classItem) return;
    
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const classes = JSON.parse(raw) as ClassItem[];
        const updatedClasses = classes.map(c => 
          c.id === id ? { ...c, [field]: value } : c
        );
        localStorage.setItem(LS_KEY, JSON.stringify(updatedClasses));
        setClassItem({ ...classItem, [field]: value });
      }
    } catch (err) {
      console.error("Failed to save changes", err);
    }
  };

  const handleDelete = () => {
    if (!confirm("Ushbu sinf o'chirilsinmi?")) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const classes = JSON.parse(raw) as ClassItem[];
        const updatedClasses = classes.filter(c => c.id !== id);
        localStorage.setItem(LS_KEY, JSON.stringify(updatedClasses));
        navigate('/classes');
      }
    } catch (err) {
      console.error("Failed to delete", err);
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    if (!confirm("Haqiqatan ham bu o'quvchini o'chirmoqchimisiz?")) return;
    try {
      const res = await fetch(`/api/data/students/${studentId}`, { method: 'DELETE' });
      if (res.ok) {
        setStudentsList(prev => prev.filter(s => s.id !== studentId));
      }
    } catch (e) {
      console.error(e);
      alert("O'chirishda xatolik yuz berdi");
    }
  };

  const submitAddStudent = async () => {
    if (!classItem) return;
    if (!newLastName.trim() || !newFirstName.trim()) return;
    
    const fullName = `${newLastName.trim()} ${newFirstName.trim()}`;

    const newStudent = { 
      name: fullName, 
      grade: classItem.name, 
      gpa: "0.0", 
      status: 'Faol' 
    };
    
    try {
      const res = await fetch('/api/data/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStudent)
      });
      if (res.ok) {
        const saved = await res.json();
        setStudentsList(prev => [...prev, saved]);
        setIsAddModalOpen(false);
        setNewLastName('');
        setNewFirstName('');
      }
    } catch (e) {
      console.error(e);
      alert("Xato yuz berdi");
    }
  };



  if (loading) {
    return (
      <div className="py-20 text-center text-zinc-400 text-sm">
        <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin mx-auto mb-3" />
        Yuklanmoqda...
      </div>
    );
  }

  if (!classItem) {
    return (
      <div className="text-center py-20 animate-in fade-in zoom-in-95 duration-300">
        <h2 className="text-2xl font-semibold text-zinc-900">Sinf topilmadi</h2>
        <button 
          onClick={() => navigate('/classes')}
          className="text-sm text-blue-600 hover:underline mt-4 inline-block"
        >
          Ortga qaytish
        </button>
      </div>
    );
  }

  const classStudents = studentsList
    .filter(s => s.grade === classItem.name)
    .sort((a, b) => parseFloat(b.gpa || "0") - parseFloat(a.gpa || "0"));

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300 max-w-2xl mx-auto">
      <button 
        onClick={() => navigate('/classes')}
        className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 mb-6 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Sinflarga qaytish
      </button>

      <div className="bg-white rounded-3xl shadow-sm border border-zinc-200 overflow-hidden">
        {/* Header Section */}
        <div 
          className="px-8 py-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6"
          style={{
            background: isTib(classItem)
              ? 'linear-gradient(135deg, #faf5ff, #ede9fe)'
              : isGreen(classItem)
              ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)'
              : 'linear-gradient(135deg, #eff6ff, #dbeafe)',
          }}
        >
          <div className="flex items-center gap-5">
            <div 
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-3xl font-black shadow-sm"
              style={isTib(classItem)
                ? { background: '#e9d5ff', color: '#7c3aed' }
                : isGreen(classItem)
                ? { background: '#bbf7d0', color: '#15803d' }
                : { background: '#bfdbfe', color: '#1d4ed8' }
              }
            >
              {formatClassName(classItem.name)}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-zinc-900">{classItem.name.toUpperCase()} — sinfi</h1>
              <span 
                className="inline-block text-sm font-semibold px-3 py-1 rounded-full mt-2 shadow-sm"
                style={isTib(classItem)
                  ? { background: '#ddd6fe', color: '#5b21b6' }
                  : isGreen(classItem)
                  ? { background: '#86efac', color: '#14532d' }
                  : { background: '#93c5fd', color: '#1e3a8a' }
                }
              >
                {isTib(classItem) ? '🩺 Tibbiyot Group' : isGreen(classItem) ? '🟢 Green Group' : '🔵 Blue Group'}
              </span>
            </div>
          </div>

          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white/60 text-red-600 hover:bg-white hover:shadow-sm transition-all"
          >
            <Trash2 className="w-4 h-4" />
            O'chirish
          </button>
        </div>

        {/* Details Section */}
        <div className="p-8 space-y-2">
          <h2 className="text-sm font-bold text-zinc-900 uppercase tracking-wider mb-4">Sinf ma'lumotlari</h2>
          
          <EditableRow 
            icon={<GraduationCap className="w-5 h-5" />} 
            label="Sinf rahbari" 
            value={String(classItem.teacher)} 
            onSave={v => persistChange('teacher', v)} 
          />

          {/* Read-only row for actual student count */}
          <div className="flex items-center gap-4 py-4 border-b border-zinc-100 last:border-0">
            <div className="p-3 rounded-xl bg-zinc-50 text-zinc-400">
              <Users className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">O'quvchilar soni (Jami)</p>
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-zinc-900">
                  {studentsList.filter(s => s.grade === classItem.name).length}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Students List Section */}
        <div className="p-8 border-t border-zinc-100 bg-zinc-50/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h2 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">Ushbu sinf o'quvchilari</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 bg-zinc-900 text-white px-3 py-2 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors active:scale-95 shadow"
              >
                <Plus className="w-4 h-4" />
                Qo'shish
              </button>
            </div>
          </div>
          
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
            {classStudents.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-sm">
                Bu sinfda hali o'quvchilar yo'q.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {classStudents.map((student, idx) => {
                  const rank = idx + 1;
                  let rankColor = "bg-zinc-100 text-zinc-600";
                  if (rank === 1) rankColor = "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-400/50 shadow-sm";
                  else if (rank === 2) rankColor = "bg-slate-100 text-slate-700 ring-1 ring-slate-300 shadow-sm";
                  else if (rank === 3) rankColor = "bg-orange-100 text-orange-800 ring-1 ring-orange-300 shadow-sm";

                  return (
                    <div key={student.id} className="flex items-center justify-between p-4 hover:bg-zinc-50 transition-colors group">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center text-xs font-bold">
                          {rank}
                        </div>
                        <p className="text-sm font-semibold text-zinc-900">{student.name}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-medium">
                        <span className="text-zinc-500">Baho: {student.gpa}</span>
                        <span className={`px-2.5 py-0.5 rounded-full font-bold tracking-wide ${rankColor}`}>
                          {rank}-o'rin
                        </span>
                        <button 
                          onClick={() => handleDeleteStudent(student.id)}
                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          title="O'chirish"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Add Student Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-zinc-900">Yangi o'quvchi</h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Familiya
                </label>
                <input
                  type="text"
                  placeholder="Masalan: Aliyev"
                  value={newLastName}
                  onChange={e => setNewLastName(e.target.value)}
                  className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-shadow"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Ism
                </label>
                <input
                  type="text"
                  placeholder="Masalan: Vali"
                  value={newFirstName}
                  onChange={e => setNewFirstName(e.target.value)}
                  className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-shadow"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50/50 border-t border-zinc-100 flex gap-3">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl font-medium text-sm text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors"
              >
                Bekor qilish
              </button>
              <button
                onClick={submitAddStudent}
                disabled={!newLastName.trim() || !newFirstName.trim()}
                className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Qo'shish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Editable row matching the modal's editable row from before */
function EditableRow({ 
  icon, label, value, type = 'text', onSave, 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  type?: string;
  onSave: (v: string) => void; 
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => { setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.select(), 50); };
  const save = () => { onSave(draft); setEditing(false); };

  return (
    <div className="flex items-center gap-4 py-4 border-b border-zinc-100 last:border-0 group/row">
      <div className="p-3 rounded-xl bg-zinc-50 text-zinc-400">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">{label}</p>
        
        {editing ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              ref={inputRef}
              type={type}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              className="w-full max-w-xs border border-zinc-300 rounded-lg px-3 py-1.5 text-base font-semibold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-zinc-900 transition-all"
            />
            <button onClick={save} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors">
              <Check className="w-5 h-5" />
            </button>
            <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-zinc-900">{value}</span>
            <button 
              onClick={open}
              className="text-sm font-medium text-blue-600 opacity-0 group-hover/row:opacity-100 transition-opacity hover:underline"
            >
              Tahrirlash
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
