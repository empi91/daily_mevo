type PluralForms = {
  singular: string
  few: string
  many: string
}

const ROWER: PluralForms = {
  singular: 'rower',
  few: 'rowery',
  many: 'rowerów',
}

const ROWER_ZWYKLY: PluralForms = {
  singular: 'rower zwykły',
  few: 'rowery zwykłe',
  many: 'rowerów zwykłych',
}

const ROWER_ELEKTRYCZNY: PluralForms = {
  singular: 'rower elektryczny',
  few: 'rowery elektryczne',
  many: 'rowerów elektrycznych',
}

const PROBKA: PluralForms = {
  singular: 'próbka',
  few: 'próbki',
  many: 'próbek',
}

function pluralize(n: number, forms: PluralForms): string {
  const abs = Math.abs(n)
  if (abs === 1) return forms.singular
  const lastTwo = abs % 100
  const last = abs % 10
  if (lastTwo >= 12 && lastTwo <= 14) return forms.many
  if (last >= 2 && last <= 4) return forms.few
  return forms.many
}

export function bikesLabel(n: number): string {
  return pluralize(n, ROWER)
}

export function plainBikesLabel(n: number): string {
  return pluralize(n, ROWER_ZWYKLY)
}

export function ebikesLabel(n: number): string {
  return pluralize(n, ROWER_ELEKTRYCZNY)
}

export function samplesLabel(n: number): string {
  return pluralize(n, PROBKA)
}
