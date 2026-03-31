'use client'

interface ChipStackProps {
  amount: number
  label?: string
  compact?: boolean
}

interface ChipConfig {
  value: number
  className: string
}

const CHIP_CONFIGS: ChipConfig[] = [
  { value: 500,  className: 'chip chip-black' },
  { value: 100,  className: 'chip chip-blue' },
  { value: 25,   className: 'chip chip-green' },
  { value: 5,    className: 'chip chip-red' },
  { value: 1,    className: 'chip chip-white' },
]

/** Build a visual chip stack: returns array of chip classnames to render */
function buildChipStack(amount: number, maxChips = 8): string[] {
  const chips: string[] = []
  let remaining = amount

  for (const { value, className } of CHIP_CONFIGS) {
    const count = Math.min(Math.floor(remaining / value), maxChips - chips.length)
    for (let i = 0; i < count; i++) {
      chips.push(className)
    }
    remaining -= count * value
    if (chips.length >= maxChips) break
  }

  return chips
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`
  return `$${amount.toLocaleString()}`
}

export function ChipStack({ amount, label, compact = false }: ChipStackProps) {
  if (amount <= 0) return null

  const chips = buildChipStack(amount, compact ? 5 : 8)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div className="chip-stack" style={{ height: compact ? 28 : 48 }}>
        {chips.map((cls, i) => (
          <div key={i} className={cls} />
        ))}
      </div>
      <span
        style={{
          fontSize: compact ? '10px' : '11px',
          fontWeight: 700,
          color: '#a8d8a8',
          fontFamily: 'monospace',
        }}
      >
        {label ?? formatAmount(amount)}
      </span>
    </div>
  )
}
