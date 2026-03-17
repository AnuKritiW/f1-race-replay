import type { RaceState, RaceTimeline, SessionInfo, AvailableSession, TimingState, ScrubFrame } from '../types'

const BASE = '/api'
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY ?? 'dev'
const ADMIN_HEADERS = { 'X-Admin-Key': ADMIN_KEY }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: ADMIN_HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function adminDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: ADMIN_HEADERS })
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

export const fetchAvailableSessions = (year: number): Promise<AvailableSession[]> =>
  adminGet(`/admin/sessions/available?year=${year}`)

export const postIngest = (race_id: string, session_key: number): Promise<{ race_id: string; status: string }> =>
  adminPost('/admin/sessions/ingest', { race_id, session_key })

export const fetchIngestProgress = (race_id: string): Promise<{ total: number; done: number; status: string }> =>
  adminGet(`/admin/sessions/${race_id}/progress`)

export const fetchActiveIngests = (): Promise<Record<string, { done: number; total: number }>> =>
  adminGet('/admin/sessions/ingest/active')

export const cancelIngest = (race_id: string): Promise<{ race_id: string; status: string }> =>
  adminDelete(`/admin/sessions/${race_id}/ingest`)

export const deleteSession = (race_id: string): Promise<{ race_id: string; status: string }> =>
  adminDelete(`/admin/sessions/${race_id}`)
