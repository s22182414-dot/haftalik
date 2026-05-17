const GRADES = [
  { name: 'Aliyev Vali', math: 5, physics: 4, english: 5, history: 4 },
  { name: 'Karimova Nargiza', math: 5, physics: 5, english: 5, history: 5 },
  { name: 'Rustamov Jasur', math: 3, physics: 4, english: 4, history: 5 },
  { name: 'Nazarova Malika', math: 4, physics: 5, english: 4, history: 4 },
];

export default function Grades() {
  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-zinc-900">Baholar jurnali</h2>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
           <span className="font-medium text-zinc-700 text-sm bg-white px-3 py-1 rounded-md border border-zinc-200">Chorak: 3-chorak</span>
           <span className="font-medium text-zinc-700 text-sm bg-white px-3 py-1 rounded-md border border-zinc-200">Sinf: 11-A</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white text-zinc-500 font-medium border-b border-zinc-100">
              <tr>
                <th className="px-6 py-4">O'quvchi</th>
                <th className="px-6 py-4 text-center">Matematika</th>
                <th className="px-6 py-4 text-center">Fizika</th>
                <th className="px-6 py-4 text-center">Ingliz tili</th>
                <th className="px-6 py-4 text-center">Tarix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {GRADES.map((student, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-zinc-900 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-xs font-medium text-white shadow-sm">
                       {student.name.charAt(0)}
                    </div>
                    {student.name}
                  </td>
                  <GradeCell grade={student.math} />
                  <GradeCell grade={student.physics} />
                  <GradeCell grade={student.english} />
                  <GradeCell grade={student.history} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GradeCell({ grade }: { grade: number }) {
  let color = 'text-zinc-700 bg-zinc-100';
  if (grade === 5) color = 'text-emerald-700 bg-emerald-50 border border-emerald-100';
  if (grade === 4) color = 'text-blue-700 bg-blue-50 border border-blue-100';
  if (grade <= 3) color = 'text-amber-700 bg-amber-50 border border-amber-100';

  return (
    <td className="px-6 py-4 text-center">
      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm shadow-sm ${color}`}>
        {grade}
      </span>
    </td>
  );
}
