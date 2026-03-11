export type CarState = { x: number; y: number; speed?: number }
export type RaceState = { timestamp: number; cars: Record<string, CarState> }
export type RaceTimeline = { start_time: number; end_time: number; duration: number }

export type SessionInfo = {
  race_id: string
  session_key: number
  session_name: string
  session_type: string
  event_name: string
  year: number
  date_start: string
  country_name: string
}

export type AvailableSession = {
  session_key: number
  session_name: string
  session_type: string
  event_name: string
  year: number
  date_start: string
  country_name: string
  circuit_short_name: string
  ingested: boolean
  race_id: string | null
}

export type DriverStanding = {
  driver_id: string
  position: number | null
  gap_to_leader: number | null   // >= 1000 means lapped: N laps = value - 1000
  interval: number | null
  last_lap_duration: number | null
  best_lap_duration: number | null
  lap_number: number
  compound: string | null
  tyre_age: number
  is_fastest_lap: boolean
  status: 'active' | 'eliminated' | 'out'
  eliminated_in_phase: number | null  // 1=Q1, 2=Q2, null=not eliminated
  out_reason: 'DNF' | 'DNS' | 'DSQ' | null
}

export type TimingState = {
  timestamp: number
  standings: DriverStanding[]
  race_lap: number | null
}
