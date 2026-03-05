import type { RaceState, RaceTimeline } from '../types'

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

export const fetchTrack = (raceId: string): Promise<Array<{ x: number; y: number }>> =>
  get(`/races/${raceId}/track`)
