import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Context, LastCall } from '../types'

const last = atom({ plugin: 'cache-wetter', key: 'last' } as const, null)
const ttl = atom({ plugin: 'cache-wetter', key: 'ttl' } as const, null)
const context = atom({ plugin: 'cache-wetter', key: 'context' } as const, null)
const isFolded = atom({ plugin: 'cache-wetter', key: 'isFolded' } as const, false)
const tick = atom({ plugin: 'cache-wetter', key: 'tick' } as const, 0)

const FALLBACK_THRESHOLD = 83
const CELLS = 20
const CHUNK = 1800 // das Terminal zeigt pro Log-Zeile höchstens 2000 Zeichen

// ---------- Hilfen ----------

function fmt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function weather(c: Context | null): '☀️' | '🌧️' | '⛈️' {
  if (c === null || c.percent === null) return '☀️'
  const share = c.percent / c.threshold
  if (share <= 0.5) return '☀️'
  if (share <= 0.8) return '🌧️'
  return '⛈️'
}

/** Teilt an Absätzen; zu lange Absätze an Zeilen, notfalls hart. */
function chunks(text: string): string[] {
  const out: string[] = []
  let cur = ''
  const push = (piece: string) => {
    const joined = cur === '' ? piece : cur + '\n\n' + piece
    if (joined.length <= CHUNK) {
      cur = joined
      return
    }
    if (cur !== '') out.push(cur)
    cur = ''
    if (piece.length <= CHUNK) {
      cur = piece
      return
    }
    let line = ''
    for (const l of piece.split('\n')) {
      if ((line + '\n' + l).length > CHUNK) {
        if (line !== '') out.push(line)
        line = l
        while (line.length > CHUNK) {
          out.push(line.slice(0, CHUNK))
          line = line.slice(CHUNK)
        }
      } else line = line === '' ? l : line + '\n' + l
    }
    cur = line
  }
  for (const para of text.split(/\n\s*\n/)) if (para.trim() !== '') push(para.trim())
  if (cur !== '') out.push(cur)
  return out
}

async function refreshContext($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const bd = u.context.breakdown
    let threshold = FALLBACK_THRESHOLD
    let isThresholdRead = false
    if (bd?.isAutoCompactEnabled && bd.autoCompactThreshold && u.context.window > 0) {
      threshold = Math.round((bd.autoCompactThreshold / u.context.window) * 100)
      isThresholdRead = true
    }
    const next: Context = { percent: u.context.percent ?? null, threshold, isThresholdRead }
    await update($, context, () => next)
  } catch {
    // Kontext nicht lesbar: alten Wert behalten
  }
}

// ---------- Zustand des Moduls (startet bei jedem Neuladen neu) ----------

let stopTimer: (() => void) | undefined
let pending: { before?: number; after?: number; fallback?: string } | null = null
let summary: string | undefined

/** Neuzeichnen jede Minute, ausgerichtet auf die letzte Antwort */
function startTimer($: EngineInterface): void {
  stopTimer?.()
  const t = $.clock.every(60_000, () => {
    void update($, tick, n => n + 1)
  })
  stopTimer = () => t.cancel()
}

function flush($: EngineInterface): void {
  if (pending === null) return
  const p = pending
  pending = null
  const text = summary ?? p.fallback
  summary = undefined
  const before = p.before !== undefined ? fmt(p.before) : '?'
  const after = p.after !== undefined ? fmt(p.after) : '?'
  $.ui.log(`🗜️ Compact: ${before} → ${after} Tokens`)
  if (text === undefined || text.trim() === '') {
    $.ui.log('(Keine Zusammenfassung lesbar)')
    return
  }
  const parts = chunks(text)
  parts.forEach((part, i) => {
    $.ui.log(parts.length > 1 ? `Zusammenfassung ${i + 1}/${parts.length}\n${part}` : `Zusammenfassung\n${part}`)
  })
}

// ---------- Modul ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    startTimer($)
    await refreshContext($)
    return r
  })

  // Jede Anfrage des Hauptchats: Zeitpunkt, Cache-Laufzeit, Hit-Rate
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const at = await $.clock.now()
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const call: LastCall = {
        at,
        hitRate: total > 0 ? Math.round((u.cache_read_input_tokens / total) * 100) : null,
      }
      await update($, last, () => call)
      // Laufzeit aus dem, was diese Anfrage in den Cache geschrieben hat;
      // hat sie nur gelesen, gilt die zuletzt geschriebene weiter.
      if ((u.ephemeral_1h_input_tokens ?? 0) > 0) await update($, ttl, () => '1h' as const)
      else if ((u.ephemeral_5m_input_tokens ?? 0) > 0) await update($, ttl, () => '5m' as const)
      startTimer($)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await refreshContext($)
    return r
  })

  // ---------- Compact: Zusammenfassung in den Chat ----------

  on('classic.PostCompact', ($, e, next) => {
    summary = e.compact_summary
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    if (e.trigger !== 'manual' && e.trigger !== 'plugin') return r
    if (r.skip !== undefined) return r
    pending = {
      before: r.tokensBefore,
      after: r.tokensAfter,
      fallback: r.messages.find(m => m.role === 'user')?.text,
    }
    // kurz warten, falls PostCompact (mit dem genauen Text) erst danach kommt
    $.clock.after(1000, () => flush($))
    await refreshContext($)
    return r
  })

  // ---------- Leiste ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, tick)
    const call = await read($, last)
    const cacheTtl = await read($, ttl)
    const ctx = await read($, context)
    const folded = await read($, isFolded)
    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)

    // 1. Cache-Restzeit
    let cacheText = 'Cache –'
    let bar = ''
    let barColor: 'success' | 'warning' | 'error' = 'success'
    if (call !== null && cacheTtl !== null) {
      const ttlMs = cacheTtl === '1h' ? 3_600_000 : 300_000
      const leftMs = Math.max(0, call.at + ttlMs - now)
      const share = leftMs / ttlMs
      if (leftMs === 0) cacheText = 'Cache abgelaufen'
      else cacheText = `Cache ${Math.ceil(leftMs / 60_000)} min`
      const filled = Math.ceil(share * CELLS)
      bar = '■'.repeat(filled) + '□'.repeat(CELLS - filled)
      barColor = share <= 0.1 ? 'error' : share <= 0.25 ? 'warning' : 'success'
    }
    const cacheColor = cacheText === 'Cache abgelaufen' ? 'error' : barColor

    const sky = weather(ctx)
    const percent = ctx?.percent ?? null
    const ctxText = percent === null ? 'Kontext –' : `Kontext ${percent} %`
    const threshold = ctx?.threshold ?? FALLBACK_THRESHOLD
    const isStorm = sky === '⛈️'

    const toggle = (
      <Button
        key="fold"
        label={folded ? '▸' : '▾'}
        plain
        dimColor
        onPress={() => update($, isFolded, v => !v)}
      />
    )

    if (folded) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text>{sky}</Text>
          <Text color={cacheColor}>{cacheText}</Text>
          <Text>{ctxText}</Text>
          {toggle}
        </Box>
      )
    }

    const doCompact = async () => {
      const queue = () =>
        $.command.run({ command: 'compact' }).catch(err => $.ui.toast(`/compact fehlgeschlagen: ${String(err)}`))
      if (e.props.isWorking || e.surface === 'desktop') {
        $.ui.toast('/compact eingereiht – startet, sobald Claude fertig ist')
        void queue()
        return
      }
      try {
        await $.session.compact()
      } catch {
        $.ui.toast('/compact eingereiht – startet, sobald Claude fertig ist')
        void queue()
      }
    }

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={cacheColor}>{cacheText}</Text>
        {bar !== '' ? <Text color={barColor}>{bar}</Text> : null}
        <Text dimColor>│</Text>
        <Text>Hit {call?.hitRate != null ? `${call.hitRate} %` : '–'}</Text>
        <Text dimColor>│</Text>
        <Text>{sky}</Text>
        <Text>{ctxText}</Text>
        <Text dimColor>
          (Compact bei {threshold} %{ctx !== null && !ctx.isThresholdRead ? ', Ersatzwert' : ''})
        </Text>
        <Button
          key="compact"
          label="Compact"
          variant={isStorm ? 'primary' : undefined}
          dimColor={isStorm ? undefined : true}
          onPress={() => void doCompact()}
        />
        {toggle}
      </Box>
    )
  })
}
