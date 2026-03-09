import type { RaceState, RaceTimeline, SessionInfo, AvailableSession } from '../types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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

export const fetchDriverColors = (raceId: string): Promise<Record<string, string>> =>
  get(`/races/${raceId}/drivers`)

export const fetchSessions = (): Promise<SessionInfo[]> =>
  get('/sessions')

export const fetchAvailableSessions = (year: number): Promise<AvailableSession[]> =>
  get(`/admin/sessions/available?year=${year}`)

export const postIngest = (race_id: string, session_key: number): Promise<{ race_id: string; status: string }> =>
  post('/admin/sessions/ingest', { race_id, session_key })

export const fetchIngestProgress = (race_id: string): Promise<{ total: number; done: number; status: string }> =>
  get(`/admin/sessions/${race_id}/progress`)

export const fetchActiveIngests = (): Promise<Record<string, { done: number; total: number }>> =>
  get('/admin/sessions/ingest/active')

export const cancelIngest = (race_id: string): Promise<{ race_id: string; status: string }> => {
  return fetch(`${BASE}/admin/sessions/${race_id}/ingest`, { method: 'DELETE' }).then((r) => r.json())
}

export const deleteSession = (race_id: string): Promise<{ race_id: string; status: string }> =>
  fetch(`${BASE}/admin/sessions/${race_id}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    return r.json()
  })
