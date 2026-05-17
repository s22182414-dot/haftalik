const SCHEDULE = [
  { day: 'Dushanba', lessons: ['Matematika', 'Ona tili', 'Fizika', 'Jismoniy tarbiya', 'Ingliz tili'] },
  { day: 'Seshanba', lessons: ['Tarix', 'Matematika', 'Geografiya', 'Kimyo', 'Biologiya'] },
  { day: 'Chorshanba', lessons: ['Ona tili', 'Adabiyot', 'Informatika', 'Fizika', 'Matematika'] },
  { day: 'Payshanba', lessons: ['Ingliz tili', 'Tarix', 'Huquq', 'Chizmachilik', 'Jismoniy tarbiya'] },
  { day: 'Juma', lessons: ['Kimyo', 'Matematika', 'Biologiya', 'Tarbiya', 'Musiqa'] },
];

export default function Schedule() {
  return (
    <div className="animate-in fade-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-zinc-900">Dars jadvali (Joriy hafta)</h2>
        <select className="bg-white border border-zinc-200 text-zinc-700 px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900/10 cursor-pointer hover:bg-zinc-50 transition-colors">
          <option>11-A sinf</option>
          <option>10-B sinf</option>
          <option>9-A sinf</option>
        </select>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 font-medium">
              <tr>
                <th className="px-6 py-4 w-40 border-b border-zinc-200">Hafta kuni</th>
                <th className="px-6 py-4 border-b border-zinc-200">1-dars</th>
                <th className="px-6 py-4 border-b border-zinc-200">2-dars</th>
                <th className="px-6 py-4 border-b border-zinc-200">3-dars</th>
                <th className="px-6 py-4 border-b border-zinc-200">4-dars</th>
                <th className="px-6 py-4 border-b border-zinc-200">5-dars</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {SCHEDULE.map((day, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-5 font-semibold text-zinc-900">{day.day}</td>
                  {day.lessons.map((lesson, i) => (
                    <td key={i} className="px-6 py-5">
                      <span className="inline-block px-3 py-1.5 bg-zinc-100 text-zinc-700 rounded-md font-medium text-xs">
                        {lesson}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
