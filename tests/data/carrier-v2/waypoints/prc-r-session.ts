// tests/data/carrier-v2/waypoints/prc-r-session.ts
// Ruta del storageState del usuario del perfil «Solo PRC R» (carrier 1040) para TM-1826.
// Lo genera `scripts/login-prc-r-session.ts`; el spec nunca hace login con contrasena.
export function prcRStorageStatePath(env: string): string {
  return `storage/state-carrier-prc-r-1040-${env}.json`;
}
