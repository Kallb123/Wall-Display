import type { SpecialDaysService } from './service'

// Holds the running special days service between the special days plugin and useSpecialDays(). Not auto-imported.
let current: SpecialDaysService | undefined

export function setSpecialDays(service: SpecialDaysService | undefined): void {
  current = service
}

export function getSpecialDays(): SpecialDaysService | undefined {
  return current
}
