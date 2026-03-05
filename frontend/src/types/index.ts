export type CarState = { x: number; y: number; speed?: number }
export type RaceState = { timestamp: number; cars: Record<string, CarState> }
export type RaceTimeline = { start_time: number; end_time: number; duration: number }
