export default function CharacterCard({ character, onDelete }) {
  return (
    <div className="char-card">
      <div className="char-card-header">
        <span className="char-avatar">👤</span>
        <span className="char-name">{character.name}</span>
        <span className="char-role">{character.role}</span>
        {onDelete && (
          <button className="char-delete" onClick={() => onDelete(character.id)}>
            ×
          </button>
        )}
      </div>
      {character.traits && (
        <div className="char-traits">
          {character.traits.split(/[,，、]/).map((t, i) => (
            <span key={i} className="char-trait-tag">
              {t.trim()}
            </span>
          ))}
        </div>
      )}
      {character.background && (
        <p className="char-background">{character.background}</p>
      )}
    </div>
  )
}
