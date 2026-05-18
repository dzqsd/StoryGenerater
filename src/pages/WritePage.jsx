import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProject,
  getCharactersByProject,
  getChaptersByProject,
  updateChapterContent,
  getSetting,
} from '../db'
import { streamChat } from '../api/deepseek'

function buildWritingPrompt(project, characters, chapters, targetChapter) {
  const charList = characters.length > 0
    ? characters.map((c) => `- ${c.name}（${c.role}）：${c.traits || ''}；背景：${c.background || ''}`).join('\n')
    : '暂无'

  const chapterList = chapters.length > 0
    ? chapters.map((c) => `第${c.number}章「${c.title || ''}」- ${c.summary || '(无概要)'}${c.content ? ' [已写]' : ' [待写]'}`).join('\n')
    : '暂无'

  const idx = chapters.findIndex((c) => c.id === targetChapter.id)
  const prevChapter = idx > 0 ? chapters[idx - 1] : null
  const nextChapter = idx < chapters.length - 1 ? chapters[idx + 1] : null

  // ====== 构建前文章节上下文 ======
  let previousContext = ''

  if (idx > 0) {
    // 前一章完整内容（最重要的衔接参考）
    if (prevChapter.content) {
      previousContext += `
====== 上一章完整内容（第${prevChapter.number}章「${prevChapter.title}」）—— 请仔细阅读，确保衔接 ======
${prevChapter.content}
`
    } else {
      previousContext += `
====== 上一章（第${prevChapter.number}章「${prevChapter.title}」）—— 尚未写作 ======
概要：${prevChapter.summary || '(无)'}
`
    }

    // 前 2-3 章内容摘要（提取关键结尾，帮助 AI 记住近期剧情）
    const recentChapters = chapters.slice(Math.max(0, idx - 4), idx - 1)
    const recentWithContent = recentChapters.filter((c) => c.content)
    if (recentWithContent.length > 0) {
      previousContext += `\n====== 更早章节关键回顾（按时间顺序） ======\n`
      for (const chap of recentWithContent) {
        // 取每章最后 ~400 字作为该章结尾状态，让 AI 知道角色和剧情停在何处
        const ending = chap.content.length > 400
          ? '...' + chap.content.slice(-400).replace(/\n/g, ' ')
          : chap.content.replace(/\n/g, ' ')
        previousContext += `【第${chap.number}章「${chap.title}」结尾】${ending}\n\n`
      }
    }

    // 更早的章节：用一行摘要列出关键事件时间线
    const earlyChapters = chapters.slice(0, Math.max(0, idx - 4))
    const earlyWithContent = earlyChapters.filter((c) => c.content || c.summary)
    if (earlyWithContent.length > 0) {
      previousContext += `\n====== 早期章节时间线 ======\n`
      for (const chap of earlyWithContent) {
        previousContext += `第${chap.number}章「${chap.title}」：${chap.summary || '(无概要)'}${chap.content ? ` [约${Math.round(chap.content.length / 2)}字]` : ''}\n`
      }
    }
  }

  return `你是一位专业小说作家。根据以下设定，撰写指定章节的正文。

====== 作品设定 ======
- 标题：${project.title || '未定'}
- 题材：${project.genre || '未定'}
- 世界观/背景：${project.setting || '未定'}
- 主线概要：${project.synopsis || '未定'}

====== 人物列表（请严格保持人物设定一致） ======
${charList}

====== 章节目录 ======
${chapterList}
${previousContext}

====== 当前写作任务 ======
撰写「第${targetChapter.number}章 ${targetChapter.title || ''}」
章节概要：${targetChapter.summary || '(无)'}
${idx === 0 ? '这是第一章，请写出精彩的开篇。' : `请确保与第${prevChapter.number}章结尾无缝衔接，不要重复描写前章已写过的内容。`}
${nextChapter ? `下一章概要（仅供参考方向，不要在本章写出下一章的内容）：${nextChapter.summary}` : '这是最后一章，请写出圆满的结局。'}
${targetChapter.content ? `已有草稿：\n${targetChapter.content}\n\n请在已有草稿基础上继续优化扩写，保持原有情节走向：` : '请撰写本章正文：'}

写作要求：
1. 字数要求：至少 1200 字，目标 1500 字左右，不超过 2000 字。字数不足会严重影响作品质量，请务必达标。
2. 展开描写：不要只是概括叙述，要有具体的场景、对话、动作、心理描写，让读者身临其境。
3. 保持人物性格统一，文风一致。
4. 与上一章的内容无缝衔接，开头可以用一两句话自然回顾上一章结尾的关键状态。
5. 纯文本，不使用 markdown 格式。
6. 直接写正文，不要加"第X章"标题。`
}

export default function WritePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editorRef = useRef(null)

  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [content, setContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [showOutline, setShowOutline] = useState(true)

  // Load data
  useEffect(() => {
    (async () => {
      const p = await getProject(id)
      if (!p) { navigate('/'); return }
      setProject(p)

      const chars = await getCharactersByProject(id)
      setCharacters(chars)

      const chaps = await getChaptersByProject(id)
      setChapters(chaps)

      // Auto-select first planned/draft chapter
      if (chaps.length > 0) {
        const firstDraft = chaps.find((c) => c.status === 'draft')
        const firstPlanned = chaps.find((c) => c.status === 'planned')
        const target = firstDraft || firstPlanned || chaps[0]
        setSelectedId(target.id)
        setContent(target.content || '')
      }
    })()
  }, [id, navigate])

  const selected = chapters.find((c) => c.id === selectedId)

  const handleSelect = (chap) => {
    setSelectedId(chap.id)
    setContent(chap.content || '')
    setError('')
    setSavedMsg('')
  }

  const handleGenerate = async () => {
    if (!selected || generating) return

    const key = await getSetting('apiKey')
    if (!key) {
      setError('请先在设置页面配置 API Key')
      return
    }

    setError('')
    setSavedMsg('')
    setGenerating(true)
    setContent('')
    editorRef.current?.focus()

    const systemPrompt = buildWritingPrompt(project, characters, chapters, selected)
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: selected.content
        ? '请优化扩写这一章的内容，扩充到1500字左右，增加场景、对话和心理描写的细节。'
        : `请开始写第${selected.number}章「${selected.title || ''}」的正文，要求1500字左右，有充分的场景描写、人物对话和心理活动。` },
    ]

    let fullContent = ''

    await streamChat(messages, {
      apiKey: key,
      temperature: 0.85,
      maxTokens: 8192,
      onChunk(chunk) {
        fullContent += chunk
        setContent(fullContent)
      },
      onDone() {
        setGenerating(false)
      },
      onError(err) {
        setError(err)
        setGenerating(false)
      },
    })
  }

  const handleSave = async () => {
    if (!selected || saving) return
    setSaving(true)
    setError('')
    try {
      await updateChapterContent(selected.id, content)
      // Update local state
      setChapters((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? { ...c, content, status: content ? 'draft' : c.status }
            : c
        )
      )
      setSavedMsg('已保存')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (err) {
      setError('保存失败: ' + err.message)
    }
    setSaving(false)
  }

  const handleRegenerate = async () => {
    if (!selected || generating) return
    setContent('')
    await handleGenerate()
  }

  const handleExportChapter = () => {
    if (!selected || !content) return
    const text = `第${selected.number}章 ${selected.title || ''}\n\n${content}`
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `第${selected.number}章 ${selected.title || ''}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusLabel = (status) => {
    switch (status) {
      case 'planned': return { text: '待写', cls: 'status-planned' }
      case 'draft': return { text: '草稿', cls: 'status-draft' }
      case 'done': return { text: '完成', cls: 'status-done' }
      default: return { text: status, cls: '' }
    }
  }

  if (!project) return <div className="empty-state"><p>加载中...</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexShrink: 0 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}`)}>
          ← 返回总览
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/chat`)}>
          💬 策划对话
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/read`)}>
          📖 阅读模式
        </button>
        <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{project.title} — 写作</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowOutline(!showOutline)}>
          {showOutline ? '隐藏大纲' : '显示大纲'}
        </button>
      </div>

      {error && (
        <div className="card" style={{ border: '1px solid #e94560', color: '#e94560', padding: '8px 16px', marginBottom: 12, flexShrink: 0 }}>
          {error}
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 12 }} onClick={() => setError('')}>关闭</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left: Chapter list */}
        <div style={{ width: 260, flexShrink: 0, overflowY: 'auto' }}>
          <h3 style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>章节列表 ({chapters.length})</h3>
          {chapters.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <p style={{ fontSize: 13 }}>还没有章节，先去策划对话中规划章节吧</p>
            </div>
          ) : (
            chapters.map((c) => {
              const st = statusLabel(c.status)
              const isActive = c.id === selectedId
              return (
                <div
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className="card"
                  style={{
                    padding: '10px 14px',
                    marginBottom: 6,
                    cursor: 'pointer',
                    borderLeft: isActive ? '3px solid #e94560' : '3px solid transparent',
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: '#e94560', fontWeight: 700 }}>第{c.number}章</span>
                    <span className={`chapter-status ${st.cls}`} style={{ fontSize: 11 }}>{st.text}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{c.title || '未命名'}</div>
                  {c.summary && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{c.summary.slice(0, 40)}{c.summary.length > 40 ? '...' : ''}</div>}
                  {c.content && (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      约 {Math.round(c.content.length / 2)} 字
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Right: Writing area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {selected ? (
            <>
              {/* Outline panel */}
              {showOutline && chapters.length > 0 && (
                <div className="outline-panel">
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 600 }}>章节大纲</div>
                  {chapters.map((c) => (
                    <div
                      key={c.id}
                      className={`outline-item ${c.id === selectedId ? 'active' : ''}`}
                      onClick={() => handleSelect(c)}
                    >
                      <span className="outline-item-num">第{c.number}章</span>
                      <span>{c.title || '未命名'}</span>
                      {c.summary && <span style={{ color: '#666', marginLeft: 'auto', fontSize: 11 }}>{c.summary.slice(0, 20)}{c.summary.length > 20 ? '...' : ''}</span>}
                      <span className={`chapter-status ${statusLabel(c.status).cls}`} style={{ fontSize: 10, marginLeft: 4 }}>{statusLabel(c.status).text}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 10, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>
                    第{selected.number}章 {selected.title || '未命名'}
                  </span>
                  <span className={`chapter-status ${statusLabel(selected.status).cls}`}>
                    {statusLabel(selected.status).text}
                  </span>
                  {savedMsg && <span style={{ fontSize: 12, color: '#48c78e' }}>{savedMsg}</span>}
                </div>
                {selected.summary && (
                  <div style={{ fontSize: 13, color: '#999', lineHeight: 1.6, background: '#0f3460', borderRadius: 8, padding: '8px 12px', borderLeft: '3px solid #e94560' }}>
                    📋 本章概要：{selected.summary}
                  </div>
                )}
              </div>

              <textarea
                ref={editorRef}
                className="form-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={generating ? 'AI 正在生成...' : '选择左侧章节，点击「生成」按钮让 AI 开始写作，或直接在此输入文本...'}
                style={{
                  flex: 1,
                  resize: 'none',
                  minHeight: 0,
                  lineHeight: 1.9,
                  fontSize: 15,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", serif',
                }}
                disabled={generating}
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexShrink: 0 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? '生成中...' : '🤖 生成'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || generating}
                >
                  {saving ? '保存中...' : '💾 保存'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleRegenerate}
                  disabled={generating}
                >
                  🔄 重新生成
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleExportChapter}
                  disabled={!content}
                >
                  📥 导出本章
                </button>
                <span style={{ fontSize: 12, color: '#666', alignSelf: 'center', marginLeft: 'auto' }}>
                  {content ? `约 ${Math.round(content.length / 2)} 字` : ''}
                </span>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>请先在策划对话中规划章节，然后选择左侧章节开始写作 ✍️</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
