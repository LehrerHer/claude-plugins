export type LastCall = {
  /** Start der letzten Hauptchat-Anfrage (ms), ab hier läuft der Cache */
  at: number
  /** Anteil der Input-Tokens aus dem Cache, 0..100; null wenn kein Input */
  hitRate: number | null
}

export type Context = {
  /** Kontextfüllung in % */
  percent: number | null
  /** Auto-Compact-Schwelle in % des Fensters */
  threshold: number
  /** true, wenn die Schwelle aus der Session gelesen wurde (sonst 83 % Ersatz) */
  isThresholdRead: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-wetter': {
      last: LastCall | null
      ttl: '5m' | '1h' | null
      context: Context | null
      isFolded: boolean
      tick: number
    }
  }
}
