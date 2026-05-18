import { parseAIMessage } from '../utils/chatParser'

export default function ChatMessage({ message, onOptionClick }) {
  const isUser = message.role === 'user'
  const { text, options } = isUser
    ? { text: message.content, options: null }
    : parseAIMessage(message.content)

  return (
    <div className={`chat-message ${isUser ? 'user' : 'ai'}`}>
      <div className="chat-avatar">{isUser ? '👤' : '🤖'}</div>
      <div className="chat-bubble-wrap">
        <div className={`chat-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}`}>
          {text && <div className="chat-text">{text}</div>}
          {options && (
            <div className="chat-options">
              {options.map((opt, i) => (
                <button
                  key={i}
                  className="chat-option-btn"
                  onClick={() => onOptionClick?.(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
