import { useMemo, useState } from 'react'
import {
  projectSimple,
  projectCompounded,
  projectManual,
  projectionCurve,
  nextCompoundEstimateDays,
  type CompoundingConfig,
} from '../lib/compounding'
import { IconRepeat, IconGas } from './icons'
import { Segmented, PreviewRow } from './form'

// Display estimate — the projection is illustrative, not a quote. The real gas and
// APR are resolved at run time by the agent / venue.
const COMPOUND_GAS_USD = 0.15

type Mode = 'agent' | 'manual'

const HORIZONS: { key: string; label: string }[] = [
  { key: '30', label: '1M' },
  { key: '90', label: '3M' },
  { key: '365', label: '1Y' },
]

const INTERVALS: { key: string; label: string }[] = [
  { key: '7', label: 'Weekly' },
  { key: '30', label: 'Monthly' },
  { key: '90', label: 'Quarterly' },
]

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function humanDays(d: number): string {
  if (!Number.isFinite(d)) return '—'
  if (d < 1) return 'today'
  if (d < 2) return '~1 day'
  if (d < 45) return `~${Math.round(d)} days`
  if (d < 365) return `~${Math.round(d / 30)} months`
  return `~${(d / 365).toFixed(1)} years`
}

/**
 * Auto-compound projection card for the Yield flow, bound to the selected pool.
 * Two cadence modes: "agent" lets the gas-aware gate decide when to compound;
 * "manual" compounds on a fixed schedule the operator picks. The toggle records the
 * operator's intent; the compound delegation it will add to the plan is wired
 * separately (the compound delegation + agent runner).
 */
export function CompoundProjection({
  positionValueUsd,
  apr,
  aprIsEstimate = false,
  poolLabel,
  enabled,
  onToggle,
}: {
  positionValueUsd: number
  apr: number
  aprIsEstimate?: boolean
  poolLabel?: string
  enabled: boolean
  onToggle: (v: boolean) => void
}) {
  const [horizonDays, setHorizonDays] = useState(365)
  const [mode, setMode] = useState<Mode>('agent')
  const [intervalDays, setIntervalDays] = useState(30)

  const config = useMemo<CompoundingConfig>(
    () => ({ principal: positionValueUsd, apr, gasCost: COMPOUND_GAS_USD }),
    [positionValueUsd, apr],
  )

  const hasValue = positionValueUsd > 0 && apr > 0
  const simple = useMemo(() => projectSimple(config, horizonDays), [config, horizonDays])
  const comp = useMemo(
    () => (mode === 'agent' ? projectCompounded(config, horizonDays) : projectManual(config, horizonDays, intervalDays)),
    [config, horizonDays, mode, intervalDays],
  )
  const nextDays = useMemo(
    () => (mode === 'agent' ? nextCompoundEstimateDays(config, horizonDays) : intervalDays),
    [config, horizonDays, mode, intervalDays],
  )
  const curve = useMemo(
    () => projectionCurve(config, horizonDays, 32, mode === 'manual' ? intervalDays : undefined),
    [config, horizonDays, mode, intervalDays],
  )
  const extra = comp.finalValue - simple
  const extraPositive = extra >= -1e-6

  // Sparkline geometry: normalise both lines to the same band.
  const W = 100
  const H = 40
  const maxV = Math.max(config.principal, ...curve.map((p) => Math.max(p.compounded, p.simple)))
  const minV = Math.min(config.principal, ...curve.map((p) => Math.min(p.compounded, p.simple)))
  const span = maxV - minV || 1
  const px = (i: number) => (curve.length > 1 ? (i / (curve.length - 1)) * W : 0)
  const py = (v: number) => H - ((v - minV) / span) * H
  const path = (key: 'simple' | 'compounded') =>
    curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p[key]).toFixed(1)}`).join(' ')

  return (
    <div className="rounded-xl glass-soft ring-1 ring-line p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--accent)' }}>
            <IconRepeat size={16} />
          </span>
          <div>
            <div className="text-sm font-semibold text-ink">Auto-compound</div>
            <div className="text-[11px] text-faint">
              Reinvest fees{poolLabel ? ` into ${poolLabel}` : ''} — only when it beats the gas.
            </div>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-dim">{enabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label="Enable auto-compound"
          />
        </label>
      </div>

      {!hasValue ? (
        <p className="text-xs text-faint">Enter amounts to see the projection.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Segmented
              options={[
                { key: 'agent', label: 'Agent' },
                { key: 'manual', label: 'Manual' },
              ]}
              value={mode}
              onChange={(v) => setMode(v)}
            />
            <Segmented
              options={HORIZONS.map((h) => ({ key: h.key, label: h.label }))}
              value={String(horizonDays)}
              onChange={(v) => setHorizonDays(Number(v))}
            />
          </div>

          {mode === 'manual' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-faint">Compound</span>
              <Segmented
                options={INTERVALS.map((i) => ({ key: i.key, label: i.label }))}
                value={String(intervalDays)}
                onChange={(v) => setIntervalDays(Number(v))}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg glass ring-1 ring-line p-3">
              <div className="text-[11px] text-faint uppercase tracking-wide">Hold</div>
              <div className="font-mono text-lg text-dim tnum mt-1">{usd(simple)}</div>
              <div className="text-[11px] text-faint mt-0.5">no compounding</div>
            </div>
            <div
              className="rounded-lg ring-1 p-3"
              style={{
                background: extraPositive ? 'var(--accent-soft)' : 'transparent',
                borderColor: extraPositive ? 'var(--accent-line)' : 'var(--color-danger)',
              }}
            >
              <div
                className="text-[11px] uppercase tracking-wide"
                style={{ color: extraPositive ? 'var(--accent)' : 'var(--color-danger)' }}
              >
                {mode === 'agent' ? 'Auto-compound' : 'Manual'}
              </div>
              <div className="font-mono text-lg text-ink tnum mt-1">{usd(comp.finalValue)}</div>
              <div
                className="text-[11px] mt-0.5"
                style={{ color: extraPositive ? 'var(--accent)' : 'var(--color-danger)' }}
              >
                {extraPositive ? '+' : '−'}
                {usd(Math.abs(extra))} {extraPositive ? 'extra' : 'lost to gas'}
              </div>
            </div>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none" aria-hidden="true">
            <path d={path('simple')} fill="none" stroke="var(--color-dim)" strokeWidth="1" opacity="0.5" />
            <path
              d={path('compounded')}
              fill="none"
              stroke={extraPositive ? 'var(--accent)' : 'var(--color-danger)'}
              strokeWidth="1.5"
            />
          </svg>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <PreviewRow label="Effective APY">
              <span className="font-mono text-ink tnum text-xs">
                {pct(comp.effectiveApr)}
                {aprIsEstimate && <span className="text-faint"> · est.</span>}
              </span>
            </PreviewRow>
            <PreviewRow label="Compounds">
              <span className="font-mono text-ink tnum text-xs">{comp.compounds}×</span>
            </PreviewRow>
            <PreviewRow label={mode === 'agent' ? 'Next compound' : 'Every'}>
              <span className="text-ink text-xs">{mode === 'agent' ? humanDays(nextDays) : humanDays(intervalDays)}</span>
            </PreviewRow>
            <PreviewRow label="Gas / compound">
              <span className="font-mono text-dim tnum text-xs">{usd(COMPOUND_GAS_USD)}</span>
            </PreviewRow>
          </div>

          <p className="text-[11px] text-faint leading-relaxed flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">
              <IconGas size={12} />
            </span>
            <span>
              {mode === 'agent'
                ? "The agent reinvests fees only when the extra yield they'll earn beats the gas — so a small or low-yield position waits and a large one runs often, never at a loss."
                : 'Compounds on your fixed schedule regardless of gas — switch to Agent to let it optimise and never lose to gas.'}{' '}
              Figures are estimates.
            </span>
          </p>
        </>
      )}
    </div>
  )
}
