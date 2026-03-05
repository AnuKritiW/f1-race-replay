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
  ingested: boolean
  race_id: string | null
}
