export function driverColor(driverId: string): string {
  let hash = 0
  for (let i = 0; i < driverId.length; i++) {
    hash = driverId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return `hsl(${Math.abs(hash) % 360}, 90%, 55%)`
}
