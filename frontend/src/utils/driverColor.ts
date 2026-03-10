// Team colours keyed by driver acronym (covers 2023–2025 grids)
const TEAM_COLORS: Record<string, string> = {
  // Red Bull
  VER: '#3671C6', PER: '#3671C6',
  // Ferrari
  LEC: '#E8002D', SAI: '#E8002D', HAM: '#E8002D',
  // McLaren
  NOR: '#FF8000', PIA: '#FF8000',
  // Mercedes
  RUS: '#27F4D2', ANT: '#27F4D2',
  // Aston Martin
  ALO: '#229971', STR: '#229971',
  // Alpine
  GAS: '#FF87BC', OCO: '#FF87BC', DOO: '#FF87BC', COL: '#FF87BC',
  // Williams
  ALB: '#64C4FF', SAR: '#64C4FF',
  // RB / AlphaTauri / VCARB
  TSU: '#6692FF', RIC: '#6692FF', LAW: '#6692FF', HAD: '#6692FF', DEV: '#6692FF',
  // Kick Sauber / Alfa Romeo
  ZHO: '#52E252', BOT: '#52E252', HUL: '#52E252', BOR: '#52E252',
  // Haas
  MAG: '#B6BABD', BEA: '#B6BABD',
}

export function driverColor(driverId: string): string {
  if (TEAM_COLORS[driverId]) return TEAM_COLORS[driverId]
  // Fallback: hash-based colour for unknown drivers
  let hash = 0
  for (let i = 0; i < driverId.length; i++) {
    hash = driverId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return `hsl(${Math.abs(hash) % 360}, 90%, 55%)`
}
