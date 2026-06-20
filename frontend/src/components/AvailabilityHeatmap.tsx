import type { AvailabilitySlot } from '../api/stations'
import { bikesLabel, samplesLabel } from '../polish'

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

function cellColor(total: number, sampleCount: number): string {
  if (sampleCount < 1) return 'bg-gray-200'
  if (total <= 1) return 'bg-red-500'
  if (total <= 3) return 'bg-orange-400'
  if (total <= 6) return 'bg-yellow-400'
  if (total <= 9) return 'bg-lime-400'
  return 'bg-green-500'
}

function cellTitle(slot: AvailabilitySlot | undefined, time: string): string {
  if (!slot || slot.sample_count < 1) {
    return `${time} — brak danych`
  }
  const total = Math.round(slot.avg_bikes + slot.avg_ebikes)
  return `${time} — śr. ${total} ${bikesLabel(total)} łącznie (${slot.sample_count} ${samplesLabel(slot.sample_count)})`
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
                    className={`h-6 flex-1 rounded-sm ${cellColor(Math.round((slot?.avg_bikes ?? 0) + (slot?.avg_ebikes ?? 0)), slot?.sample_count ?? 0)}`}
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
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> ≥10 rowerów łącznie
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-lime-400" /> 7–9 rowerów łącznie
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400" /> 4–6 rowerów łącznie
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-orange-400" /> 2–3 rowery łącznie
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> 0–1 rower łącznie
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-gray-200" /> brak danych
          </span>
        </div>
      </div>
    </div>
  )
}
