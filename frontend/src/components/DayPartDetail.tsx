import { useState } from 'react'
import type { AvailabilitySlot } from '../api/stations'
import { bikesLabel, plainBikesLabel, ebikesLabel } from '../polish'
import { type DayPart, DAY_PARTS, currentDayPartIndex } from './dayParts'

const SHOW_RELIABILITY = true

function parseTime(timeSlot: string): number {
  const [h, m] = timeSlot.split(':').map(Number)
  return h * 60 + m
}

function inRange(timeSlot: string, part: DayPart): boolean {
  const [h] = timeSlot.split(':').map(Number)
  if (part.endHour <= 24) {
    return h >= part.startHour && h < part.endHour
  }
  return h >= part.startHour || h < part.endHour - 24
}

function tierSoftColor(total: number): string {
  if (total >= 10) return 'var(--tier-4-soft)'
  if (total >= 7) return 'var(--tier-3-soft)'
  if (total >= 4) return 'var(--tier-2-soft)'
  if (total >= 2) return 'var(--tier-1-soft)'
  return 'var(--tier-0-soft)'
}

interface Props {
  availability: AvailabilitySlot[]
  selectedDay: number
}

export default function DayPartDetail({ availability, selectedDay }: Props) {
  const [expandedParts, setExpandedParts] = useState<Set<number>>(() => new Set([currentDayPartIndex()]))

  const daySlots = availability
    .filter((s) => s.day_of_week === selectedDay)
    .sort((a, b) => parseTime(a.time_slot) - parseTime(b.time_slot))

  function toggle(partIdx: number) {
    setExpandedParts((prev) => {
      const next = new Set(prev)
      if (next.has(partIdx)) {
        next.delete(partIdx)
      } else {
        next.add(partIdx)
      }
      return next
    })
  }

  return (
    <div className="space-y-2">
      {DAY_PARTS.map((part, partIdx) => {
        const partSlots = daySlots.filter((s) => inRange(s.time_slot, part))
        const avgTotal =
          partSlots.length > 0
            ? partSlots.reduce((sum, s) => sum + s.avg_bikes + s.avg_ebikes, 0) /
              partSlots.length
            : 0
        const avgTotalRounded = Math.round(avgTotal)
        const isExpanded = expandedParts.has(partIdx)

        return (
          <div key={partIdx} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(partIdx)}
              className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:opacity-80 transition-colors text-left"
            >
              <div>
                <span className="font-extrabold text-text">{part.name}</span>
                <span className="text-muted text-sm ml-2">{part.range}</span>
                {partSlots.length > 0 && (
                  <span className="text-muted text-sm ml-2">
                    · średnio {avgTotalRounded} {bikesLabel(avgTotalRounded)}
                  </span>
                )}
              </div>
              <svg
                className="w-4 h-4 text-muted transition-transform"
                style={{ transform: isExpanded ? 'rotate(180deg)' : undefined }}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>

            {isExpanded && (
              <div className="px-4 py-3">
                {partSlots.length === 0 ? (
                  <p className="text-sm text-muted py-2">Brak danych dla tego okresu</p>
                ) : (
                  <div className="grid grid-cols-6 gap-2">
                    {partSlots.map((slot) => {
                      const bikes = Math.round(slot.avg_bikes)
                      const ebikes = Math.round(slot.avg_ebikes)
                      const total = bikes + ebikes
                      const isLowConfidence = slot.reliability_label === 'uncertain' || slot.reliability_label === 'empty'
                      return (
                        <div
                          key={slot.time_slot}
                          className="rounded-[11px] flex flex-col"
                          style={{
                            backgroundColor: tierSoftColor(total),
                            height: '132px',
                            padding: '10px 11px',
                          }}
                        >
                          <span
                            className="font-mono"
                            style={{ fontSize: '12px', fontWeight: 500, color: 'rgba(0,0,0,.5)' }}
                          >
                            {slot.time_slot.slice(0, 5)}
                          </span>

                          {ebikes > 0 && (
                            <div className="flex items-baseline gap-1 mt-1">
                              <span style={{ fontSize: '20px', fontWeight: 800, color: 'rgba(0,0,0,.82)' }}>
                                {ebikes}
                              </span>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,0,0,.5)' }}>
                                {ebikesLabel(ebikes)}
                              </span>
                            </div>
                          )}

                          {bikes > 0 && (
                            <div className="flex items-baseline gap-1">
                              <span style={{ fontSize: '20px', fontWeight: 800, color: 'rgba(0,0,0,.82)' }}>
                                {bikes}
                              </span>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,0,0,.5)' }}>
                                {plainBikesLabel(bikes)}
                              </span>
                            </div>
                          )}

                          <div className="mt-auto" style={{ borderTop: '1px solid rgba(0,0,0,.18)' }}>
                            <div className="flex items-baseline gap-1 mt-1">
                              <span style={{ fontSize: '20px', fontWeight: 800, color: 'rgba(0,0,0,.82)' }}>
                                {total}
                              </span>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(0,0,0,.5)' }}>
                                {SHOW_RELIABILITY && isLowConfidence ? 'średnio · niepewne' : 'średnio'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
