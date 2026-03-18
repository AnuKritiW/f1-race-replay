import type { RaceState, RaceTimeline, SessionInfo, TimingState, ScrubFrame } from '../types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const fetchTimeline = (raceId: string): Promise<RaceTimeline> =>
  get(`/races/${raceId}/timeline`)

export const fetchState = (raceId: string, at: number): Promise<RaceState> =>
  get(`/races/${raceId}/state?at=${at}`)

export const fetchLive = (raceId: string): Promise<RaceState> =>
  get(`/races/${raceId}/live`)

export const fetchBulkStates = (raceId: string): Promise<RaceState[]> =>
  get(`/races/${raceId}/states`)

export const fetchBulkTiming = (raceId: string): Promise<TimingState[]> =>
  get(`/races/${raceId}/timing`)

export const fetchScrubBuffer = (raceId: string): Promise<ScrubFrame[]> =>
  get(`/races/${raceId}/scrub`)

export const fetchTileStates = (raceId: string, from: number, to: number): Promise<RaceState[]> =>
  get(`/races/${raceId}/states?from=${from}&to=${to}`)

export const fetchTileTiming = (raceId: string, from: number, to: number): Promise<TimingState[]> =>
  get(`/races/${raceId}/timing?from=${from}&to=${to}`)

export const fetchTrack = (raceId: string): Promise<Array<{ x: number; y: number }>> =>
  get(`/races/${raceId}/track`)

export const fetchDriverColors = (raceId: string): Promise<Record<string, string>> =>
  get(`/races/${raceId}/drivers`)

export const fetchSessions = (): Promise<SessionInfo[]> =>
  get('/sessions')
