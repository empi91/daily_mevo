import type { CSSProperties } from 'react'
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

function cellColorStyle(total: number, sampleCount: number): CSSProperties {
  if (sampleCount < 1) return { backgroundColor: 'var(--color-border)' }
  if (total <= 1) return { backgroundColor: 'var(--tier-0)' }
  if (total <= 3) return { backgroundColor: 'var(--tier-1)' }
  if (total <= 6) return { backgroundColor: 'var(--tier-2)' }
  if (total <= 9) return { backgroundColor: 'var(--tier-3)' }
  return { backgroundColor: 'var(--tier-4)' }
}

const TICK_HOURS = [5, 8, 11, 14, 17, 20]

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

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour tick labels — every 3 hours */}
        <div className="relative ml-11 mb-1 h-4">
          {TICK_HOURS.map((h) => {
            const slotOffset = (h - START_HOUR) * SLOTS_PER_HOUR
            const widthPct = (SLOTS_PER_HOUR * 3 / TOTAL_SLOTS) * 100
            const leftPct = (slotOffset / TOTAL_SLOTS) * 100
            return (
              <div
                key={h}
                className="absolute text-xs font-mono text-muted text-center"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              >
                {h}:00
              </div>
            )
          })}
        </div>

        {/* Grid rows */}
        {grid.map((row, dayIdx) => (
          <div
            key={dayIdx}
            className={`flex items-center cursor-pointer rounded transition-colors ${
              selectedDay === dayIdx ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-surface'
            }`}
            onClick={() => onSelectDay(dayIdx)}
          >
            <div className="w-11 text-xs font-bold text-muted text-right pr-2 shrink-0">
              {DAY_LABELS[dayIdx]}
            </div>
            <div className="flex flex-1 gap-[3px] py-0.5">
              {row.map((slot, slotIdx) => {
                const hour = START_HOUR + Math.floor(slotIdx / SLOTS_PER_HOUR)
                const minute = (slotIdx % SLOTS_PER_HOUR) * 15
                const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
                return (
                  <div
                    key={slotIdx}
                    className="h-[26px] flex-1 rounded-[5px]"
                    style={cellColorStyle(Math.round((slot?.avg_bikes ?? 0) + (slot?.avg_ebikes ?? 0)), slot?.sample_count ?? 0)}
                    title={cellTitle(slot, timeStr)}
                  />
                )
              })}
            </div>
          </div>
        ))}

        {/* Legend — 5 tiers */}
        <div className="flex flex-wrap items-center gap-4 mt-3 ml-11 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[5px]" style={{ backgroundColor: 'var(--tier-4)' }} /> ≥10 rowerów łącznie
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[5px]" style={{ backgroundColor: 'var(--tier-3)' }} /> 7–9
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[5px]" style={{ backgroundColor: 'var(--tier-2)' }} /> 4–6
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[5px]" style={{ backgroundColor: 'var(--tier-1)' }} /> 2–3
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[5px]" style={{ backgroundColor: 'var(--tier-0)' }} /> 0–1
          </span>
        </div>
      </div>
    </div>
  )
}
