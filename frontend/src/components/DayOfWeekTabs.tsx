const DAY_LABELS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'] as const

interface Props {
  selectedDay: number
  onSelectDay: (day: number) => void
}

export default function DayOfWeekTabs({ selectedDay, onSelectDay }: Props) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {DAY_LABELS.map((label, i) => (
        <button
          key={i}
          onClick={() => onSelectDay(i)}
          className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
            selectedDay === i
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
