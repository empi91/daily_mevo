import { useState } from 'react'
import type { AvailabilitySlot } from '../api/stations'
import { bikesLabel, plainBikesLabel, ebikesLabel } from '../polish'
import { type DayPart, DAY_PARTS, currentDayPartIndex } from './dayParts'

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

function labelColor(label: string): string {
  switch (label) {
    case 'reliable':
      return 'bg-green-100 text-green-800'
    case 'uncertain':
      return 'bg-yellow-100 text-yellow-800'
    case 'empty':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

function labelText(label: string): string {
  switch (label) {
    case 'reliable':
      return 'dostępne'
    case 'uncertain':
      return 'niepewne'
    case 'empty':
      return 'puste'
    default:
      return 'brak danych'
  }
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
          <div key={partIdx} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(partIdx)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div>
                <span className="font-medium text-gray-900">{part.name}</span>
                <span className="text-gray-500 text-sm ml-2">{part.range}</span>
                {partSlots.length > 0 && (
                  <span className="text-gray-500 text-sm ml-2">
                    · średnio {avgTotalRounded} {bikesLabel(avgTotalRounded)}
                  </span>
                )}
              </div>
              <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 py-2">
                {partSlots.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">Brak danych dla tego okresu</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {partSlots.map((slot) => {
                      const bikes = Math.round(slot.avg_bikes)
                      const ebikes = Math.round(slot.avg_ebikes)
                      const total = bikes + ebikes
                      return (
                        <div
                          key={slot.time_slot}
                          className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50"
                        >
                          <span className="text-sm font-mono text-gray-700">
                            {slot.time_slot.slice(0, 5)}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-900">
                              {bikes} {plainBikesLabel(bikes)} + {ebikes} {ebikesLabel(ebikes)}
                            </span>
                            <span className="text-xs text-gray-500">śr. {total}</span>
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${labelColor(slot.reliability_label)}`}
                            >
                              {labelText(slot.reliability_label)}
                            </span>
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
