import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';

interface ClassItem {
  id: string;
  name: string;
  color: 'blue' | 'green';
  teacher: string;
  students: number;
  room: string;
}

/* ── localStorage helpers ──────────────────────────────── */
const LS_KEY = 'avto_hisobot_classes';

const SEED_CLASSES: ClassItem[] = [
  { id: '1',  name: '1b',   color: 'blue',  teacher: 'Olimov Aziz',         students: 28, room: 'Xona 101' },
  { id: '2',  name: '1g',   color: 'green', teacher: 'Raximova Dilnoza',    students: 26, room: 'Xona 102' },
  { id: '3',  name: '2b',   color: 'blue',  teacher: 'Xasanov Botir',       students: 30, room: 'Xona 103' },
  { id: '4',  name: '2g',   color: 'green', teacher: 'Toshmatova Gulnora',  students: 27, room: 'Xona 104' },
  { id: '5',  name: '3b',   color: 'blue',  teacher: 'Olimov Aziz',         students: 29, room: 'Xona 201' },
  { id: '6',  name: '3g',   color: 'green', teacher: 'Raximova Dilnoza',    students: 25, room: 'Xona 202' },
  { id: '7',  name: '4b',   color: 'blue',  teacher: 'Xasanov Botir',       students: 31, room: 'Xona 203' },
  { id: '8',  name: '4g',   color: 'green', teacher: 'Toshmatova Gulnora',  students: 28, room: 'Xona 204' },
  { id: '9',  name: '5b',   color: 'blue',  teacher: 'Olimov Aziz',         students: 32, room: 'Xona 301' },
  { id: '10', name: '5g',   color: 'green', teacher: 'Raximova Dilnoza',    students: 29, room: 'Xona 302' },
  { id: '11', name: '6b',   color: 'blue',  teacher: 'Xasanov Botir',       students: 30, room: 'Xona 303' },
  { id: '12', name: '6g',   color: 'green', teacher: 'Toshmatova Gulnora',  students: 27, room: 'Xona 304' },
  { id: '13', name: '7b',   color: 'blue',  teacher: 'Olimov Aziz',         students: 33, room: 'Xona 401' },
  { id: '14', name: '7g',   color: 'green', teacher: 'Raximova Dilnoza',    students: 28, room: 'Xona 402' },
  { id: '15', name: '8b',   color: 'blue',  teacher: 'Xasanov Botir',       students: 31, room: 'Xona 403' },
  { id: '16', name: '8g',   color: 'green', teacher: 'Toshmatova Gulnora',  students: 29, room: 'Xona 404' },
  { id: '17', name: '9b',   color: 'blue',  teacher: 'Olimov Aziz',         students: 30, room: 'Xona 501' },
  { id: '18', name: '9g',   color: 'green', teacher: 'Raximova Dilnoza',    students: 26, room: 'Xona 502' },
  { id: '19', name: '10b',  color: 'blue',  teacher: 'Xasanov Botir',       students: 28, room: 'Xona 503' },
  { id: '20', name: '10g',  color: 'green', teacher: 'Toshmatova Gulnora',  students: 25, room: 'Xona 504' },
  { id: '21', name: '1tib', color: 'blue',  teacher: 'Olimov Aziz',         students: 24, room: 'Xona 601' },
  { id: '23', name: '2tib', color: 'blue',  teacher: 'Xasanov Botir',       students: 26, room: 'Xona 603' },
];

function loadFromStorage(): ClassItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as ClassItem[];
  } catch {}
  // First visit — seed from defaults
  localStorage.setItem(LS_KEY, JSON.stringify(SEED_CLASSES));
  return SEED_CLASSES;
}

function saveToStorage(data: ClassItem[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/* ── Helpers ───────────────────────────────────────────── */
function isTib(c: ClassItem): boolean {
  return c.name.toLowerCase().includes('tib');
}

function isGreen(c: ClassItem): boolean {
  if (isTib(c)) return false;
  return c.color === 'green' || c.name.toLowerCase().endsWith('g');
}

// "1b" → "1-B", "10g" → "10-G", "1tib" → "1-TIB"
function formatClassName(name: string): string {
  const match = name.match(/^(\d+)(.*)/);
  if (!match) return name.toUpperCase();
  const num = match[1];
  const suffix = match[2] ? match[2].toUpperCase() : '';
  return suffix ? `${num}-${suffix}` : num;
}

/* ── Main component ────────────────────────────────────── */
export default function Classes() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [studentsList, setStudentsList] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    setClasses(loadFromStorage());
    
    // O'quvchilarni API dan o'qib haqiqiy sonini aniqlaymiz
    fetch('/api/data/students')
      .then(r => r.json())
      .then(data => {
        setStudentsList(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Persist every change
  const persist = (updated: ClassItem[]) => {
    setClasses(updated);
    saveToStorage(updated);
  };

  /* ── CRUD ── */
  const handleAdd = () => {
    const name = prompt('Sinf nomi (masalan: 11b yoki 11g):');
    if (!name?.trim()) return;
    const nameLc = name.trim().toLowerCase();
    const color: 'blue' | 'green' = nameLc.endsWith('g') ? 'green' : 'blue';
    const teacher  = prompt('Sinf rahbari:') || "Noma'lum";
    const students = parseInt(prompt("O'quvchilar soni:") || '0', 10);
    const room     = prompt('Xona raqami:') || "Xona yo'q";

    const newClass: ClassItem = {
      id: Date.now().toString(),
      name: nameLc,
      color,
      teacher,
      students,
      room,
    };
    persist([...classes, newClass]);
  };

  const handleDelete = (id: string) => {
    if (!confirm("O'chirilsinmi?")) return;
    persist(classes.filter(c => c.id !== id));
  };

/* ── Classes.tsx Excel logic removed and moved to ClassDetails ── */

  /* ── Render ── */
  if (loading) {
    return (
      <div className="py-20 text-center text-zinc-400 text-sm">
        <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-500 rounded-full animate-spin mx-auto mb-3" />
        Yuklanmoqda...
      </div>
    );
  }

  const tibClasses   = classes.filter(c => isTib(c));
  const blueClasses  = classes.filter(c => !isTib(c) && !isGreen(c));
  const greenClasses = classes.filter(c => !isTib(c) && isGreen(c));

  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">Sinflar</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Jami {classes.length} ta sinf
          </p>
        </div>
        
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors active:scale-95 shadow"
        >
          <Plus className="w-4 h-4" />
          Sinf qo'shish
        </button>
      </div>

      {classes.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-16 text-center text-zinc-400 text-sm">
          Sinflar yo'q. "Qo'shish" tugmasini bosing.
        </div>
      ) : (
        <>
          {/* Blue group */}
          {blueClasses.length > 0 && (
            <section className="mb-6">
              <GroupHeader color="blue" label="Blue Group" count={blueClasses.length} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {blueClasses.map(c => {
                  const realCount = studentsList.filter(s => s.grade === c.name).length;
                  return <ClassCard key={c.id} c={{ ...c, students: realCount }} variant="blue" onClick={() => navigate(`/classes/${c.id}`)} />
                })}
              </div>
            </section>
          )}

          {/* Green group */}
          {greenClasses.length > 0 && (
            <section className="mb-6">
              <GroupHeader color="green" label="Green Group" count={greenClasses.length} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {greenClasses.map(c => {
                  const realCount = studentsList.filter(s => s.grade === c.name).length;
                  return <ClassCard key={c.id} c={{ ...c, students: realCount }} variant="green" onClick={() => navigate(`/classes/${c.id}`)} />
                })}
              </div>
            </section>
          )}

          {/* Tibbiyot group */}
          {tibClasses.length > 0 && (
            <section>
              <GroupHeader color="tib" label="Tibbiyot Group" count={tibClasses.length} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {tibClasses.map(c => {
                  const realCount = studentsList.filter(s => s.grade === c.name).length;
                  return <ClassCard key={c.id} c={{ ...c, students: realCount }} variant="tib" onClick={() => navigate(`/classes/${c.id}`)} />
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────── */

function GroupHeader({ color, label, count }: { color: 'blue' | 'green' | 'tib'; label: string; count: number }) {
  const colors = {
    blue:  { dot: 'bg-blue-500',   text: 'text-blue-600' },
    green: { dot: 'bg-green-500',  text: 'text-green-600' },
    tib:   { dot: 'bg-purple-500', text: 'text-purple-600' },
  };
  const { dot, text } = colors[color];
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`w-2.5 h-2.5 rounded-full inline-block ${dot}`} />
      <h3 className={`text-sm font-semibold uppercase tracking-wider ${text}`}>{label}</h3>
      <span className="text-xs text-zinc-400 ml-1">({count} ta)</span>
    </div>
  );
}

function ClassCard({
  c, variant, onClick,
}: {
  c: ClassItem;
  variant: 'blue' | 'green' | 'tib';
  onClick: () => void;
}) {
  const VARIANTS = {
    blue:  { accent: '#2563eb', bgLight: '#eff6ff', label: 'Blue' },
    green: { accent: '#16a34a', bgLight: '#f0fdf4', label: 'Green' },
    tib:   { accent: '#7c3aed', bgLight: '#faf5ff', label: 'Tib' },
  };
  const { accent, bgLight, label } = VARIANTS[variant];
  const displayName = formatClassName(c.name);

  return (
    <div
      className="group relative bg-white rounded-2xl shadow-sm border border-zinc-100 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
      onClick={onClick}
    >
      {/* Top color bar */}
      <div className="h-1.5 w-full" style={{ background: accent }} />

      <div className="p-5 flex flex-col gap-3">
        {/* Badge + label */}
        <div className="flex items-center justify-between">
          <div
            className="px-3 py-1.5 rounded-lg text-base font-black"
            style={{ background: bgLight, color: accent }}
          >
            {displayName}
          </div>
          <span
            className="text-xs font-semibold px-2 py-1 rounded-md"
            style={{ background: bgLight, color: accent }}
          >
            {label}
          </span>
        </div>

        {/* Students */}
        <div className="flex items-center gap-1.5 text-sm">
          <Users className="w-4 h-4 shrink-0 text-zinc-400" />
          <span className="text-zinc-500">{c.students} o'quvchi</span>
        </div>

        {/* Teacher */}
        <p className="text-sm text-zinc-500 font-medium truncate leading-tight">
          <span className="text-zinc-400 mr-1">Rahbar:</span> {c.teacher}
        </p>
      </div>
    </div>
  );
}


