import type { StationResponse, AvailabilitySlot, StationDetailResponse } from '../api/stations'

export const TEST_STATIONS: StationResponse[] = [
  {
    station_id: '4076',
    name: 'Brama Wyżynna',
    address: 'ul. Wały Jagiellońskie',
    lat: 54.3520,
    lon: 18.6466,
    capacity: 24,
  },
  {
    station_id: '3839',
    name: 'Dworzec Główny',
    address: 'ul. Podwale Grodzkie 1',
    lat: 54.3559,
    lon: 18.6440,
    capacity: 30,
  },
  {
    station_id: '4192',
    name: 'Sopot Centrum',
    address: 'ul. Bohaterów Monte Cassino',
    lat: 54.4416,
    lon: 18.5601,
    capacity: 20,
  },
  {
    station_id: '4345',
    name: 'Gdynia Skwer Kościuszki',
    address: null,
    lat: 54.5189,
    lon: 18.5500,
    capacity: 16,
  },
]

export const TEST_AVAILABILITY: AvailabilitySlot[] = [
  // Monday (0) — reliable slots in the morning
  { day_of_week: 0, time_slot: '06:00', avg_bikes: 5, avg_ebikes: 3, sample_count: 50, reliability_label: 'reliable' },
  { day_of_week: 0, time_slot: '06:15', avg_bikes: 4, avg_ebikes: 2, sample_count: 48, reliability_label: 'reliable' },
  { day_of_week: 0, time_slot: '08:00', avg_bikes: 2, avg_ebikes: 1, sample_count: 40, reliability_label: 'uncertain' },
  { day_of_week: 0, time_slot: '12:00', avg_bikes: 0, avg_ebikes: 1, sample_count: 35, reliability_label: 'empty' },
  { day_of_week: 0, time_slot: '18:00', avg_bikes: 3, avg_ebikes: 4, sample_count: 45, reliability_label: 'reliable' },
  // Tuesday (1) — mixed
  { day_of_week: 1, time_slot: '07:00', avg_bikes: 1, avg_ebikes: 0, sample_count: 3, reliability_label: 'insufficient_data' },
  { day_of_week: 1, time_slot: '09:00', avg_bikes: 3, avg_ebikes: 2, sample_count: 42, reliability_label: 'uncertain' },
  // Wednesday (2) — empty slot
  { day_of_week: 2, time_slot: '10:00', avg_bikes: 0, avg_ebikes: 0, sample_count: 30, reliability_label: 'empty' },
  // Saturday (5) — reliable afternoon
  { day_of_week: 5, time_slot: '14:00', avg_bikes: 8, avg_ebikes: 4, sample_count: 55, reliability_label: 'reliable' },
  { day_of_week: 5, time_slot: '14:15', avg_bikes: 7, avg_ebikes: 5, sample_count: 52, reliability_label: 'reliable' },
]

export const TEST_STATION_DETAIL: StationDetailResponse = {
  station_id: '4076',
  name: 'Brama Wyżynna',
  address: 'ul. Wały Jagiellońskie',
  lat: 54.3520,
  lon: 18.6466,
  capacity: 24,
  availability: TEST_AVAILABILITY,
}
