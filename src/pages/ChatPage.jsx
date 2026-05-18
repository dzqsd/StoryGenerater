import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProject, updateProject,
  getCharactersByProject, getChaptersByProject,
  getProjectConversation, saveProjectConversation,
  getSetting, saveCharacter, saveChapter,
} from '../db'
import { streamChat } from '../api/deepseek'
import ChatMessage from '../components/ChatMessage'
import PhaseIndicator from '../components/PhaseIndicator'

// ====== System Prompt Builder ======

const PHASE_ORDER = ['planning', 'characters', 'plot']

const PHASE_GUIDES = {
  planning: `当前阶段：世界观构建。
你需要帮助用户确定小说题材、世界观设定、故事背景。
先介绍自己，然后问用户想写什么类型的小说，提供几个类型选项。
每次只问1-2个问题，不要一次问太多。
当用户已明确世界观和题材后，在回复末尾加上 [PHASE:characters] 标签，引导进入人物设计阶段。`,

  characters: `当前阶段：人物设计。
你已经和用户确定了世界观。现在帮助设计主要角色——先说主角。
每个角色要问清楚：名字、性格、背景故事。设计完一个再做下一个。
设计完主角后问是否还需要配角或反派。
重要：确认角色后，在回复中用 [CHARACTER]...[/CHARACTER] 标签标注该角色信息。
当所有人物设计完成后，在回复末尾加上 [PHASE:plot] 标签，引导进入剧情规划阶段。`,

  plot: `当前阶段：主线剧情 + 章节大纲规划。
所有人物已经设计完毕。现在基于已有世界和人物：
1. 先帮助规划主线剧情——提出2-3条主线方向让用户选择，确定后梳理核心冲突、关键转折和结局。
2. 主线确定后，规划章节结构（建议8-12章），每章给出标题和详细概要（3-5句话，说清楚本章发生什么事、涉及哪些人物、推进了什么剧情）。
重要：确定剧情后，用 [SYNOPSIS]...[/SYNOPSIS] 标签总结主线概要。
重要：确定章节计划后，用 [CHAPTERS]...[/CHAPTERS] 标签列出所有章节，格式"序号. 标题 - 概要"。
注意：你只负责策划，不在此处写正文。章节正文将由用户前往专门的写作界面生成。`,
}

function detectUserPhaseIntent(message, project) {
  const currentPhase = project.phase || 'planning'
  const msg = message.toLowerCase()

  const patterns = {
    characters: [
      '进入人物', '设计人物', '设计角色', '开始人物', '人物设计', '角色设计',
      '创建角色', '设定角色', '开始设计人物', '开始设计角色',
    ],
    plot: [
      '进入剧情', '开始剧情', '剧情规划', '主线剧情', '设计剧情',
      '规划剧情', '故事主线', '剧情设计', '开始规划', '进入主线',
    ],
  }

  for (const [phase, keywords] of Object.entries(patterns)) {
    if (keywords.some((kw) => msg.includes(kw))) {
      const currentIdx = PHASE_ORDER.indexOf(currentPhase)
      const targetIdx = PHASE_ORDER.indexOf(phase)
      if (targetIdx > currentIdx) return phase
    }
  }
  return null
}

function buildSystemPrompt(project, characters, chapters) {
  const phase = project.phase || 'planning'

  const charList = characters.length > 0
    ? characters.map((c) => `- ${c.name}（${c.role}）：${c.traits || ''}；背景：${c.background || ''}`).join('\n')
    : '（暂无）'

  const chapterList = chapters.length > 0
    ? chapters.map((c) => {
        let line = `第${c.number}章「${c.title || ''}」[${c.status}] ${c.summary || ''}`
        if (c.content) {
          // 包含已写章节的前 100 字作为上下文提醒
          const preview = c.content.slice(0, 100).replace(/\n/g, ' ')
          line += `\n    已写内容开头：${preview}...`
        }
        return line
      }).join('\n')
    : '（暂无）'

  return `你是一位专业的小说创作顾问，引导用户逐步完成小说创作的策划阶段。

${PHASE_GUIDES[phase] || PHASE_GUIDES.planning}

====== 当前项目状态（请严格记住以下所有信息）======
- 标题：${project.title || '未定'}
- 题材：${project.genre || '未定'}
- 世界观/背景：${project.setting || '未定'}
- 主线概要：${project.synopsis || '未定'}
- 当前阶段：${phase}

====== 已确认的人物列表 ======
${charList}

====== 已规划的章节 ======
${chapterList}

====== 行为规则 ======
1. 始终用中文交流
2. 需要用户做选择时，在末尾用 [OPTIONS]...[/OPTIONS] 标签提供2-4个具体选项
3. 每次只聚焦当前阶段，不要跳到其他阶段
4. 用户做出决定后，用一两句话确认然后自然过渡到下一个问题
5. 不要使用markdown格式，纯文本即可
6. 人物确定后必须用 [CHARACTER]...[/CHARACTER] 标签标注。每个角色必须使用独立的 [CHARACTER] 标签块，不要把多个角色合并到同一个块中。
  格式示例：
  [CHARACTER]
  姓名：林风
  身份：主角
  性格：沉稳内敛、剑术天赋极高
  背景：被灭门的剑宗唯一幸存者，背负深仇
  [/CHARACTER]
  [CHARACTER]
  姓名：苏婉
  身份：配角
  性格：温柔善良
  背景：药王谷传人
  [/CHARACTER]
7. 主线确定后必须用 [SYNOPSIS]...[/SYNOPSIS] 标签总结
8. 章节计划确定后用 [CHAPTERS]...[/CHAPTERS] 标签列出，每行一章，格式"序号. 标题 - 概要"。概要需详细（3-5句话），不能只有一句话
9. 每当用户明确表示要进入下一阶段，或当前阶段所有必要信息已收集完毕，在回复末尾用 [PHASE:下一阶段key] 标签标识，可选值：planning, characters, plot
10. 你只负责策划——生成世界观、人物设定、剧情大纲和章节计划。不要写章节正文内容。正文将在专门的写作界面生成。`
}

// ====== Structured data extraction from AI tags ======

function extractCharacters(content) {
  const re = /\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/g
  const results = []
  let match
  while ((match = re.exec(content)) !== null) {
    const block = match[1].trim()
    // Split by "姓名" to handle AI putting multiple characters in one block
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
      const parts = line.split(/[-—–]\s*/)
      return {
        number: i + 1,
        title: (parts[0] || line).trim(),
        summary: parts[1]?.trim() || '',
      }
    })
}

// ====== ChatPage Component ======

export default function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const scrollRef = useRef(null)

  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')

  // Refs for async callbacks
  const messagesRef = useRef([])
  const projectRef = useRef(null)
  const charsRef = useRef([])
  const chapsRef = useRef([])
  const dataLoadedRef = useRef(false)

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { charsRef.current = characters }, [characters])
  useEffect(() => { chapsRef.current = chapters }, [chapters])

  // Load everything on mount, then init conversation if no saved history
  useEffect(() => {
    let cancelled = false

    const loadAndInit = async () => {
      dataLoadedRef.current = false

      const p = await getProject(id)
      if (!p || cancelled) { if (!p) navigate('/'); return }

      const chars = await getCharactersByProject(id)
      const chaps = await getChaptersByProject(id)
      const conv = await getProjectConversation(id)

      if (cancelled) return

      // Batch all state updates together to avoid stale renders triggering init too early
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

      dataLoadedRef.current = true

      // Only init a new conversation if there's no saved history
      if (!hasSaved) {
        initConversation()
      }
    }

    loadAndInit()

    return () => { cancelled = true }
  }, [id, navigate])

  const saveConv = useCallback(async (msgs) => {
    if (!projectRef.current) return
    try {
      await saveProjectConversation(Number(id), msgs)
    } catch (err) {
      console.error('保存对话失败:', err)
    }
  }, [id])

  // Scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Refresh characters & chapters from DB
  const refreshData = useCallback(async () => {
    const chars = await getCharactersByProject(id)
    setCharacters(chars)
    charsRef.current = chars
    const chaps = await getChaptersByProject(id)
    setChapters(chaps)
    chapsRef.current = chaps
  }, [id])

  const initConversation = async () => {
    const p = projectRef.current
    if (!p) return

    const key = await getSetting('apiKey')
    if (!key) {
      setError('请先在设置页面配置 API Key')
      return
    }

    const systemPrompt = buildSystemPrompt(p, [], [])
    const msgs = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '你好，我想开始创作一部小说。' },
    ]

    setMessages(msgs)
    messagesRef.current = msgs
    setStreaming(true)
    let content = ''

    await streamChat(msgs, {
      apiKey: key,
      temperature: 0.8,
      maxTokens: 2048,
      onChunk(chunk) {
        content += chunk
        setMessages([...msgs, { role: 'assistant', content }])
      },
      async onDone() {
        setStreaming(false)
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

    // Detect user intent to switch phases
    const userPhaseIntent = detectUserPhaseIntent(msg, p)
    if (userPhaseIntent) {
      const currentIdx = PHASE_ORDER.indexOf(p.phase)
      const newIdx = PHASE_ORDER.indexOf(userPhaseIntent)
      if (newIdx > currentIdx) {
        await updateProject(p.id, { phase: userPhaseIntent })
        p.phase = userPhaseIntent
        projectRef.current = p
        setProject((prev) => ({ ...prev, phase: userPhaseIntent }))
      }
    }

    const systemPrompt = buildSystemPrompt(p, charsRef.current, chapsRef.current)

    // Always put system prompt at top, keep all history
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

    await streamChat(updated, {
      apiKey: key,
      temperature: 0.8,
      maxTokens: 2048,
      onChunk(chunk) {
        content += chunk
        setMessages([...updated, { role: 'assistant', content }])
      },
      async onDone() {
        setStreaming(false)
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
      },
    })
  }

  // Process AI response: detect phase transition, extract structured data
  const processAIResponse = async (content, p) => {
    // 1. Extract and save characters from [CHARACTER] tags
    const newChars = extractCharacters(content)
    const charArr = charsRef.current
    for (const char of newChars) {
      const existing = charArr.find((c) => c.name === char.name)
      if (existing) {
        // Update existing character with any new fields (don't overwrite with empty)
        const merged = { ...existing }
        if (char.role && char.role !== '未指定') merged.role = char.role
        if (char.traits) merged.traits = char.traits
        if (char.background) merged.background = char.background
        await saveCharacter(merged)
        // Sync the in-memory array
        const idx = charArr.findIndex((c) => c.id === existing.id)
        if (idx >= 0) charArr[idx] = merged
      } else {
        const newId = await saveCharacter({ projectId: Number(id), ...char })
        charArr.push({ id: newId, projectId: Number(id), ...char })
      }
    }

    // 2. Extract synopsis from [SYNOPSIS] tag
    const synopsis = extractSynopsis(content)
    if (synopsis && !p.synopsis) {
      await updateProject(p.id, { synopsis })
      setProject((prev) => ({ ...prev, synopsis }))
      projectRef.current = { ...p, synopsis }
    }

    // 3. Extract and save chapters from [CHAPTERS] tag
    const newChapters = extractChapters(content)
    if (newChapters.length > 0) {
      const existingChapters = chapsRef.current
      for (const ch of newChapters) {
        const exists = existingChapters.find((ec) => ec.number === ch.number)
        if (!exists) {
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

    // 4. Detect phase transitions via [PHASE:xxx] tags
    const phaseMatch = content.match(/\[PHASE:(\w+)\]/)
    if (phaseMatch) {
      const targetPhase = phaseMatch[1]
      if (PHASE_ORDER.includes(targetPhase) && targetPhase !== p.phase) {
        const currentIdx = PHASE_ORDER.indexOf(p.phase)
        const newIdx = PHASE_ORDER.indexOf(targetPhase)
        if (newIdx > currentIdx) {
          await updateProject(p.id, { phase: targetPhase })
          setProject((prev) => ({ ...prev, phase: targetPhase }))
          projectRef.current = { ...p, phase: targetPhase }
        }
      }
    }

    // 5. Extract genre from first few exchanges
    if (!p.genre) {
      const genrePatterns = { '玄幻': '玄幻', '都市': '都市', '言情': '言情', '科幻': '科幻', '悬疑': '悬疑', '武侠': '武侠', '历史': '历史', '末世': '末世' }
      for (const [kw, genre] of Object.entries(genrePatterns)) {
        if (content.includes(kw)) {
          await updateProject(p.id, { genre })
          setProject((prev) => ({ ...prev, genre }))
          projectRef.current = { ...p, genre }
          break
        }
      }
    }
  }

  const handleOptionClick = (option) => {
    handleSend(option)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!project) {
    return <div className="empty-state"><p>加载中...</p></div>
  }

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}`)}>
          ← 返回总览
        </button>
        <h2 style={{ margin: 0, fontSize: 18 }}>{project.title}</h2>
        <PhaseIndicator currentPhase={project.phase || 'planning'} />
      </div>

      {error && (
        <div className="card" style={{ border: '1px solid #e94560', color: '#e94560', padding: '8px 16px', marginBottom: 12 }}>
          {error}
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 12 }} onClick={() => setError('')}>关闭</button>
        </div>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {messages
          .filter((m) => m.role !== 'system')
          .map((m, i) => (
            <ChatMessage key={i} message={m} onOptionClick={handleOptionClick} />
          ))}
        {streaming && messages.filter((m) => m.role !== 'system').length === 0 && (
          <div className="chat-message ai">
            <div className="chat-avatar">🤖</div>
            <div className="chat-bubble ai-bubble">
              <span className="typing-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="输入你的想法，或点击上方选项..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          rows={2}
        />
        <button
          className="btn btn-primary"
          onClick={() => handleSend()}
          disabled={streaming || !input.trim()}
        >
          发送
        </button>
      </div>
    </div>
  )
}
