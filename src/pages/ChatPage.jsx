import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import db, {
  getProject, updateProject,
  getCharactersByProject, getChaptersByProject,
  getProjectConversation, saveProjectConversation,
  getSetting, saveCharacter, saveChapter,
  savePlotArc,
} from '../db'
import { streamChat } from '../api/deepseek'
import ChatMessage from '../components/ChatMessage'
import { getModeConfig } from '../utils/chatModes'

// ====== Structured data extraction ======

function extractCharacters(content) {
  const re = /\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/g
  const results = []
  let match
  while ((match = re.exec(content)) !== null) {
    const block = match[1].trim()
    const segments = block.split(/\n(?=姓名[：:])/)
    for (const seg of segments) {
      if (!seg.trim()) continue
      const name = (seg.match(/姓名[：:]\s*(.+)/) || [])[1]?.trim()
      const role = (seg.match(/(?:身份|角色)[：:]\s*(.+)/) || [])[1]?.trim()
      const traits = (seg.match(/性格[：:]\s*(.+)/) || [])[1]?.trim()
      const background = (seg.match(/背景[：:]\s*(.+)/) || [])[1]?.trim()
      if (name) results.push({ name, role: role || '未指定', traits: traits || '', background: background || '' })
    }
  }
  return results
}

function extractSynopsis(content) {
  const match = content.match(/\[SYNOPSIS\]([\s\S]*?)\[\/SYNOPSIS\]/)
  return match ? match[1].trim() : null
}

function extractChapters(content) {
  const match = content.match(/\[CHAPTERS\]([\s\S]*?)\[\/CHAPTERS\]/)
  if (!match) return null
  return match[1]
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\d+[.、)\s]+/, '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const sepMatch = line.match(/[-—–]\s*/)
      let title = line
      let summary = ''
      if (sepMatch) {
        title = line.slice(0, sepMatch.index).trim()
        summary = line.slice(sepMatch.index + sepMatch[0].length).trim()
      }
      return { number: i + 1, title, summary }
    })
}

// ====== ChatPage Component ======

export default function ChatPage({ mode: propMode }) {
  const { id, mode: urlMode } = useParams()
  const mode = propMode || urlMode || 'general'
  const navigate = useNavigate()
  const scrollRef = useRef(null)

  const modeConfig = getModeConfig(mode)

  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [initialized, setInitialized] = useState(false)

  const messagesRef = useRef([])
  const projectRef = useRef(null)
  const charsRef = useRef([])
  const chapsRef = useRef([])
  const _abortRef = useRef(null)

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { charsRef.current = characters }, [characters])
  useEffect(() => { chapsRef.current = chapters }, [chapters])

  // Load data and initialize conversation
  useEffect(() => {
    let cancelled = false

    const loadAndInit = async () => {
      const p = await getProject(id)
      if (!p || cancelled) { if (!p) navigate('/'); return }

      const chars = await getCharactersByProject(id)
      const chaps = await getChaptersByProject(id)
      const conv = await getProjectConversation(id, mode)

      if (cancelled) return

      projectRef.current = p
      charsRef.current = chars
      chapsRef.current = chaps
      setProject(p)
      setCharacters(chars)
      setChapters(chaps)

      const hasSaved = conv && conv.messages && conv.messages.length > 0
      if (hasSaved) {
        setMessages(conv.messages)
        messagesRef.current = conv.messages
      }

      if (!hasSaved) {
        initConversation(p, chars, chaps)
      }
      setInitialized(true)
    }

    loadAndInit()

    return () => {
      cancelled = true
      if (_abortRef.current) {
        _abortRef.current.abort()
        _abortRef.current = null
      }
    }
  }, [id, mode])

  const saveConv = useCallback(async (msgs) => {
    if (!projectRef.current) return
    try {
      await saveProjectConversation(Number(id), mode, msgs)
    } catch (err) {
      console.error('保存对话失败:', err)
    }
  }, [id, mode])

  // Scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const refreshData = useCallback(async () => {
    const chars = await getCharactersByProject(id)
    setCharacters(chars)
    charsRef.current = chars
    const chaps = await getChaptersByProject(id)
    setChapters(chaps)
    chapsRef.current = chaps
  }, [id])

  const initConversation = async (p, chars, chaps) => {
    const key = await getSetting('apiKey')
    if (!key) {
      setError('请先在设置页面配置 API Key')
      return
    }

    const systemPrompt = modeConfig.systemPrompt(p || projectRef.current, chars || [], chaps || [])
    const triggerMsg = { role: 'user', content: '你好，我们开始吧。', _internal: true }
    const msgs = [
      { role: 'system', content: systemPrompt },
      triggerMsg,
    ]

    setMessages(msgs)
    messagesRef.current = msgs
    setStreaming(true)
    let content = ''

    const abortCtrl = new AbortController()
    _abortRef.current = abortCtrl

    await streamChat(msgs, {
      apiKey: key,
      temperature: 0.8,
      maxTokens: 2048,
      signal: abortCtrl.signal,
      onChunk(chunk) {
        content += chunk
        setMessages([...msgs, { role: 'assistant', content }])
      },
      async onDone() {
        setStreaming(false)
        _abortRef.current = null
        const final = [...msgs, { role: 'assistant', content }]
        setMessages(final)
        messagesRef.current = final
        await saveConv(final)
        await processAIResponse(content, p)
        await refreshData()
      },
      onError(err) {
        setError(err)
        setStreaming(false)
        _abortRef.current = null
      },
    })
  }

  const handleSend = async (text) => {
    const msg = text || input.trim()
    if (!msg || streaming) return

    const key = await getSetting('apiKey')
    if (!key) {
      setError('请先在设置页面配置 API Key')
      return
    }

    setError('')
    setInput('')

    const p = projectRef.current

    const systemPrompt = modeConfig.systemPrompt(p, charsRef.current, chapsRef.current)

    let allMsgs = messagesRef.current
    if (allMsgs.length === 0 || allMsgs[0].role !== 'system') {
      allMsgs = [{ role: 'system', content: systemPrompt }, ...allMsgs]
    } else {
      allMsgs = [{ role: 'system', content: systemPrompt }, ...allMsgs.slice(1)]
    }

    const updated = [...allMsgs, { role: 'user', content: msg }]
    setMessages(updated)
    messagesRef.current = updated

    setStreaming(true)
    let content = ''

    const abortCtrl = new AbortController()
    _abortRef.current = abortCtrl

    await streamChat(updated, {
      apiKey: key,
      temperature: 0.8,
      maxTokens: 2048,
      signal: abortCtrl.signal,
      onChunk(chunk) {
        content += chunk
        setMessages([...updated, { role: 'assistant', content }])
      },
      async onDone() {
        setStreaming(false)
        _abortRef.current = null
        const final = [...updated, { role: 'assistant', content }]
        setMessages(final)
        messagesRef.current = final
        await saveConv(final)
        await processAIResponse(content, p)
        await refreshData()
      },
      onError(err) {
        setError(err)
        setStreaming(false)
        _abortRef.current = null
      },
    })
  }

  // Process AI response: extract structured data based on mode
  const processAIResponse = async (content, p) => {
    // Characters extraction (characters mode + any mode that outputs [CHARACTER])
    if (modeConfig.extractCharacters || content.includes('[CHARACTER]')) {
      const newChars = extractCharacters(content)
      const charArr = charsRef.current
      for (const char of newChars) {
        const existingIdx = charArr.findIndex((c) => c.name === char.name)
        if (existingIdx >= 0) {
          const existing = charArr[existingIdx]
          const merged = { ...existing }
          if (char.role && char.role !== '未指定') merged.role = char.role
          if (char.traits) merged.traits = char.traits
          if (char.background) merged.background = char.background
          await saveCharacter(merged)
          charArr[existingIdx] = merged
        } else {
          const newId = await saveCharacter({ projectId: Number(id), ...char })
          charArr.push({ id: newId, projectId: Number(id), ...char })
        }

        // Auto-extract character arc
        if (char.background && (char.background.includes('幸存') || char.background.includes('仇恨') || char.background.includes('秘密') || char.background.includes('封印') || char.background.includes('灭门') || char.background.includes('转世'))) {
          const arcDesc = `${char.name}的角色弧光：${char.background}`
          const arcExists = await db.plot_arcs
            .where({ projectId: Number(id), description: arcDesc })
            .first()
          if (!arcExists) {
            await savePlotArc({
              projectId: Number(id),
              type: 'character_arc',
              description: arcDesc,
              status: 'open',
              relatedChapter: 0,
            })
          }
        }
      }
    }

    // Synopsis extraction (plot mode)
    if (modeConfig.extractSynopsis || content.includes('[SYNOPSIS]')) {
      const synopsis = extractSynopsis(content)
      if (synopsis && synopsis.length > 10) {
        await updateProject(p.id, { synopsis })
        setProject((prev) => ({ ...prev, synopsis }))
        projectRef.current = { ...projectRef.current, synopsis }

        // Extract plot arcs from synopsis
        const arcPatterns = [
          { re: /复仇|报仇|灭门|血海深仇/, desc: '主线复仇线' },
          { re: /阴谋|暗中|秘密|真相/, desc: '阴谋/真相线' },
          { re: /魔神|上古|封印|转世/, desc: '神话/魔神线' },
          { re: /叛徒|内鬼|出卖/, desc: '叛徒线' },
          { re: /凤凰|血脉|觉醒/, desc: '血脉觉醒线' },
        ]
        for (const { re, desc } of arcPatterns) {
          if (re.test(synopsis)) {
            const existing = await db.plot_arcs
              .where({ projectId: Number(id), description: desc })
              .first()
            if (!existing) {
              await savePlotArc({
                projectId: Number(id),
                type: 'conflict',
                description: desc,
                status: 'open',
                relatedChapter: 0,
              })
            }
          }
        }
      }
    }

    // Chapters extraction (outline mode)
    if (modeConfig.extractChapters || content.includes('[CHAPTERS]')) {
      const newChapters = extractChapters(content)
      if (newChapters.length > 0) {
        const existingChapters = chapsRef.current
        for (const ch of newChapters) {
          const exists = existingChapters.find((ec) => ec.number === ch.number)
          if (exists) {
            // Update existing chapter title/summary (preserve content and status)
            await saveChapter({
              id: exists.id,
              projectId: Number(id),
              number: ch.number,
              title: ch.title || exists.title,
              summary: ch.summary || exists.summary,
              status: exists.status,
              content: exists.content || '',
            })
          } else {
            await saveChapter({
              projectId: Number(id),
              number: ch.number,
              title: ch.title,
              summary: ch.summary,
              status: 'planned',
              content: '',
            })
          }
        }
      }
    }

    // Mode-specific data extraction (world mode - extract genre/setting)
    if (modeConfig.dataExtractor) {
      const updates = modeConfig.dataExtractor(content, p)
      if (updates && Object.keys(updates).length > 0) {
        await updateProject(p.id, updates)
        setProject((prev) => ({ ...prev, ...updates }))
        projectRef.current = { ...projectRef.current, ...updates }
      }
    }

    // Global genre extraction (for any mode)
    if (!p.genre) {
      const genrePatterns = {
        '玄幻': '玄幻', '都市': '都市', '言情': '言情', '科幻': '科幻',
        '悬疑': '悬疑', '武侠': '武侠', '历史': '历史', '末世': '末世',
      }
      for (const [kw, genre] of Object.entries(genrePatterns)) {
        if (content.includes(kw)) {
          await updateProject(p.id, { genre })
          setProject((prev) => ({ ...prev, genre }))
          projectRef.current = { ...projectRef.current, genre }
          break
        }
      }
    }
  }

  const handleSendRef = useRef(null)
  handleSendRef.current = handleSend

  const handleOptionClick = useCallback((option) => {
    handleSendRef.current?.(option)
  }, [])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!project) {
    return <div className="empty-state"><p>加载中...</p></div>
  }

  const modeOptions = [
    { value: 'general', label: '总策划' },
    { value: 'world', label: '世界观' },
    { value: 'characters', label: '人物' },
    { value: 'plot', label: '剧情' },
    { value: 'outline', label: '大纲' },
    { value: 'revision', label: '修订' },
  ]

  return (
    <div className="chat-page">
      <div className="chat-header">
        <div className="chat-header-left">
          <span className="chat-mode-badge">{modeConfig.name}</span>
          <h2 className="chat-project-title">{project.title}</h2>
        </div>
        <div className="chat-header-right">
          <select
            className="chat-mode-select"
            value={mode}
            onChange={(e) => navigate(`/project/${id}/${e.target.value}`)}
          >
            {modeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="chat-error">
          <span>{error}</span>
          <button className="btn btn-sm btn-secondary" onClick={() => setError('')}>关闭</button>
        </div>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {messages
          .filter((m) => m.role !== 'system' && !m._internal)
          .map((m, i) => (
            <ChatMessage key={i} message={m} onOptionClick={handleOptionClick} />
          ))}
        {streaming && messages.filter((m) => m.role !== 'system' && !m._internal).length === 0 && (
          <div className="chat-message ai">
            <div className="chat-avatar">AI</div>
            <div className="chat-bubble ai-bubble">
              <span className="typing-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="输入你的想法，Enter 发送，Shift+Enter 换行..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          rows={2}
        />
        <button
          className="btn btn-primary chat-send-btn"
          onClick={() => handleSend()}
          disabled={streaming || !input.trim()}
        >
          {streaming ? '生成中...' : '发送'}
        </button>
      </div>
    </div>
  )
}
