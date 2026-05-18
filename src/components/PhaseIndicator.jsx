const PHASES = [
  { key: 'planning', label: '世界观', icon: '🌍' },
  { key: 'characters', label: '人物', icon: '👤' },
  { key: 'plot', label: '剧情', icon: '📜' },
]

export default function PhaseIndicator({ currentPhase }) {
  const currentIdx = PHASES.findIndex((p) => p.key === currentPhase)

  return (
    <div className="phase-indicator">
      {PHASES.map((phase, idx) => (
        <div
          key={phase.key}
          className={`phase-dot ${idx < currentIdx ? 'done' : ''} ${idx === currentIdx ? 'active' : ''}`}
        >
          <span className="phase-icon">{phase.icon}</span>
          <span className="phase-label">{phase.label}</span>
          {idx < PHASES.length - 1 && (
            <span className={`phase-line ${idx < currentIdx ? 'done' : ''}`} />
          )}
        </div>
      ))}
    </div>
  )
}
