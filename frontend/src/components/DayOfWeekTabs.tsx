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
          className={`px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            selectedDay === i
              ? 'bg-accent text-accent-text'
              : 'bg-accent-soft text-muted hover:bg-accent/20'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
