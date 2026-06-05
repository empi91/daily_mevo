import type { AvailabilitySlot } from '../api/stations'

const DAY_LABELS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz']
const START_HOUR = 5
const END_HOUR = 23
const SLOTS_PER_HOUR = 4
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR

function slotIndex(timeSlot: string): number | null {
  const [h, m] = timeSlot.split(':').map(Number)
  if (h < START_HOUR || h >= END_HOUR) return null
  return (h - START_HOUR) * SLOTS_PER_HOUR + Math.floor(m / 15)
}

function cellColor(label: string): string {
  switch (label) {
    case 'reliable':
      return 'bg-green-500'
    case 'uncertain':
      return 'bg-yellow-400'
    case 'empty':
      return 'bg-red-500'
    default:
      return 'bg-gray-200'
  }
}

function cellTitle(slot: AvailabilitySlot | undefined, time: string): string {
  if (!slot || slot.reliability_label === 'insufficient_data') {
    return `${time} — brak danych`
  }
  return `${time} — śr. ${slot.avg_bikes.toFixed(1)} rowerów (${slot.sample_count} próbek)`
}

interface Props {
  availability: AvailabilitySlot[]
  selectedDay: number
  onSelectDay: (day: number) => void
}

export default function AvailabilityHeatmap({ availability, selectedDay, onSelectDay }: Props) {
  const grid: (AvailabilitySlot | undefined)[][] = Array.from({ length: 7 }, () =>
    Array<AvailabilitySlot | undefined>(TOTAL_SLOTS).fill(undefined),
  )

  for (const slot of availability) {
    const idx = slotIndex(slot.time_slot)
    if (idx !== null && slot.day_of_week >= 0 && slot.day_of_week < 7) {
      grid[slot.day_of_week][idx] = slot
    }
  }

  const hourLabels = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div className="flex ml-10 mb-1">
          {hourLabels.map((h) => (
            <div
              key={h}
              className="text-xs text-gray-500"
              style={{ width: `${(100 / TOTAL_SLOTS) * SLOTS_PER_HOUR}%` }}
            >
              {h}:00
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {grid.map((row, dayIdx) => (
          <div
            key={dayIdx}
            className={`flex items-center cursor-pointer rounded transition-colors ${
              selectedDay === dayIdx ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'
            }`}
            onClick={() => onSelectDay(dayIdx)}
          >
            <div className="w-10 text-xs font-medium text-gray-600 text-right pr-2 shrink-0">
              {DAY_LABELS[dayIdx]}
            </div>
            <div className="flex flex-1 gap-px py-0.5">
              {row.map((slot, slotIdx) => {
                const hour = START_HOUR + Math.floor(slotIdx / SLOTS_PER_HOUR)
                const minute = (slotIdx % SLOTS_PER_HOUR) * 15
                const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
                return (
                  <div
                    key={slotIdx}
                    className={`h-6 flex-1 rounded-sm ${cellColor(slot?.reliability_label ?? 'insufficient_data')}`}
                    title={cellTitle(slot, timeStr)}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 ml-10 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> ≥6 rowerów
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400" /> 2–5 rowerów
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> ≤1 rower
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-gray-200" /> brak danych
          </span>
        </div>
      </div>
    </div>
  )
}
