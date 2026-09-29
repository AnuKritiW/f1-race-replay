import type { RaceState, RaceTimeline, SessionInfo, TimingState, ScrubFrame } from '../types'

const BASE = '/api'
const STATIC_BASE = (import.meta.env.VITE_STATIC_BASE_URL as string | undefined)
  ?? 'https://static.formulareplay.com'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function getStatic<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

// ── Static (CloudFront) ────────────────────────────────────────────────────────

export const fetchSessions = (): Promise<SessionInfo[]> =>
  getStatic(`${STATIC_BASE}/sessions.json`)

export const fetchBulkStates = (raceId: string): Promise<RaceState[]> =>
  getStatic(`${STATIC_BASE}/${raceId}/states.json`)

export const fetchBulkTiming = (raceId: string): Promise<TimingState[]> =>
  getStatic(`${STATIC_BASE}/${raceId}/timing.json`)

export const fetchScrubBuffer = (raceId: string): Promise<ScrubFrame[]> =>
  getStatic(`${STATIC_BASE}/${raceId}/scrub.json`)

export const fetchTrack = (raceId: string): Promise<Array<{ x: number; y: number }>> =>
  getStatic(`${STATIC_BASE}/${raceId}/track.json`)

export const fetchDriverColors = (raceId: string): Promise<Record<string, string>> =>
  getStatic(`${STATIC_BASE}/${raceId}/drivers.json`)

// ── Dynamic (API) ─────────────────────────────────────────────────────────────

// Unlike states/timing, timeline is cheap to compute (two fast queries) — no benefit to
// static caching, and keeping it dynamic means race_start_time is always fresh and can't
// drift out of sync with a stale static export the way a cached timeline.json could.
export const fetchTimeline = (raceId: string): Promise<RaceTimeline> =>
  get(`/races/${raceId}/timeline`)

export const fetchState = (raceId: string, at: number): Promise<RaceState> =>
  get(`/races/${raceId}/state?at=${at}`)

export const fetchLive = (raceId: string): Promise<RaceState> =>
  get(`/races/${raceId}/live`)

export const fetchTileStates = (raceId: string, from: number, to: number): Promise<RaceState[]> =>
  get(`/races/${raceId}/states?from=${from}&to=${to}`)

export const fetchTileTiming = (raceId: string, from: number, to: number): Promise<TimingState[]> =>
  get(`/races/${raceId}/timing?from=${from}&to=${to}`)
