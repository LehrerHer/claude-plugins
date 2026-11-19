import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'cache-wetter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('Leiste zeigt Cache, Hit-Rate, Wetter und Kontext', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        tokens: 140_000,
        window: 200_000,
        percent: 70,
        breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: 160_000 },
      },
    },
  }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: {
        model: 'm', input_tokens: 10, output_tokens: 5,
        cache_read_input_tokens: 900, cache_creation_input_tokens: 90,
        ephemeral_5m_input_tokens: 90, ephemeral_1h_input_tokens: 0,
      },
    }
  } as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 } as never)) { /* */ }
  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answered' } as never)

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Cache/ }))?.text).toBe('Cache 5 min')
  expect((await ui.find({ type: 'Text', text: /^Hit/ }))?.text).toBe('Hit 90 %')
  // 70 % von 80 % Schwelle = 87,5 % → Gewitter
  expect((await ui.find({ type: 'Text', text: /⛈️/ }))?.text).toBe('⛈️')
  expect((await ui.find({ type: 'Text', text: /Compact bei/ }))?.text).toBe('(Compact bei 80 %)')
  await ui.unmount()

  await clock.advance(4 * 60_000 + 40_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Cache/ }))?.text).toBe('Cache 1 min')
  expect((await ui.find({ type: 'Text', text: /■/ }))?.text).toBe('■■□□□□□□□□□□□□□□□□□□')
  await ui.unmount()

  await clock.advance(60_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Cache/ }))?.text).toBe('Cache abgelaufen')
  await ui.unmount()
})

test('nach /compact: Tokens vorher/nachher und Zusammenfassung in Teilen', async ($, on) => {
  const clock = mock.clock(on)
  const lines: string[] = []
  on('ui.log', (_, e) => { lines.push(e.text); return { value: undefined } as never })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 200_000 } } }))
  const para = 'x'.repeat(1000)
  const text = [para, para, para].join('\n\n')
  on('classic.PostCompact', () => ({}) as never)
  on('session.compact', () => ({
    messages: [{ role: 'user', text, toolUses: [] }],
    tokensBefore: 154320,
    tokensAfter: 12480,
  }) as never)

  await $.classic.PostCompact({ hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: text } as never)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  await clock.advance(1500)

  expect(lines[0]).toBe('🗜️ Compact: 154.320 → 12.480 Tokens')
  expect(lines.length).toBe(4)
  expect(lines[1]?.startsWith('Zusammenfassung 1/3')).toBe(true)
  expect(lines.every(l => l.length <= 2000)).toBe(true)
})
