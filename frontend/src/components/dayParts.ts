export interface DayPart {
  name: string
  range: string
  startHour: number
  endHour: number
}

export const DAY_PARTS: DayPart[] = [
  { name: 'Rano', range: '6–12', startHour: 6, endHour: 12 },
  { name: 'Popołudnie', range: '12–18', startHour: 12, endHour: 18 },
  { name: 'Wieczór', range: '18–22', startHour: 18, endHour: 22 },
  { name: 'Noc', range: '22–6', startHour: 22, endHour: 30 },
]

export function currentDayPartIndex(): number {
  const hour = new Date().getHours()
  const index = DAY_PARTS.findIndex((part) => {
    if (part.endHour <= 24) {
      return hour >= part.startHour && hour < part.endHour
    }
    return hour >= part.startHour || hour < part.endHour - 24
  })
  return index >= 0 ? index : 0
}
