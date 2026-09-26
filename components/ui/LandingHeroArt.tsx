// Decorative hero for the landing page and profile gate: a fanned A-K on a
// felt pad with chip stacks. Pure markup; panels.css draws and animates it.

const SPADE_PATH =
  'M32 4.5C23.7 16.2 10.3 26 10.3 39.7c0 8.2 5.5 13.9 13.1 13.9 4.4 0 7.7-2 9.7-5.4-.4 5.2-3.4 9-9 11.3h15.8c-5.6-2.3-8.6-6.1-9-11.3 2 3.4 5.3 5.4 9.7 5.4 7.6 0 13.1-5.7 13.1-13.9C53.7 26 40.3 16.2 32 4.5Z'
const HEART_PATH =
  'M32 57.5C21.1 48.5 8.5 37.1 8.5 23.7c0-8.4 5.9-14.1 13.3-14.1 4.7 0 8.3 2.4 10.2 6.4 1.9-4 5.5-6.4 10.2-6.4 7.4 0 13.3 5.7 13.3 14.1 0 13.4-12.6 24.8-23.5 33.8Z'

function Suit({ path, className }: { path: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  )
}

function HeroCard({
  rank,
  path,
  tone,
  className,
}: {
  rank: string
  path: string
  tone: 'red' | 'black'
  className: string
}) {
  return (
    <div className={`landing-card ${className}`} data-tone={tone}>
      <span className="landing-card-corner">
        <b>{rank}</b>
        <Suit path={path} />
      </span>
      <Suit path={path} className="landing-card-pip" />
      <span className="landing-card-corner is-bottom">
        <b>{rank}</b>
        <Suit path={path} />
      </span>
    </div>
  )
}

function ChipStack({ tone, count }: { tone: 'ruby' | 'ink' | 'brass'; count: number }) {
  return (
    <div className={`landing-chip-stack is-${tone}`}>
      {Array.from({ length: count }, (_, index) => (
        <i key={index} style={{ ['--chip-i' as string]: index }} />
      ))}
    </div>
  )
}

export function LandingHeroArt({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`landing-art${compact ? ' is-compact' : ''}`} aria-hidden="true">
      <div className="landing-art-glow" />
      <div className="landing-art-table">
        <span className="landing-art-crest">Poker Night</span>
      </div>
      <div className="landing-art-chips">
        <ChipStack tone="ink" count={7} />
        <ChipStack tone="ruby" count={5} />
        <ChipStack tone="brass" count={3} />
      </div>
      <div className="landing-hand">
        <div className="landing-card landing-card-back" />
        <HeroCard rank="A" path={SPADE_PATH} tone="black" className="landing-card-a" />
        <HeroCard rank="K" path={HEART_PATH} tone="red" className="landing-card-b" />
      </div>
      <div className="landing-art-sparkles">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}
