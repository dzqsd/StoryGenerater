import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProject,
  getCharactersByProject,
  getChaptersByProject,
  updateChapterContent,
  getSetting,
  saveChapterSummary,
  getAllChapterSummaries,
  getOpenPlotArcs,
  savePlotArc,
} from '../db'
import { streamChat } from '../api/deepseek'
import {
  buildDetailedOutlinePrompt,
  buildDraftPrompt,
  buildConsistencyReviewPrompt,
  buildPolishPrompt,
  buildChapterSummaryPrompt,
  parseChapterSummaryJSON,
} from '../utils/summaryExtractor'

export default function WritePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editorRef = useRef(null)

  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [showOutline, setShowOutline] = useState(true)
  const [pipeline, setPipeline] = useState({
    stage: 'idle',
    outline: '',
    draft: '',
    review: '',
    final: '',
  })
  const pipelineRef = useRef({ abortFlag: false })

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

  const runPipeline = async () => {
    if (!selected || (pipeline.stage !== 'idle' && pipeline.stage !== 'done')) return

    const key = await getSetting('apiKey')
    if (!key) {
      setError('请先在设置页面配置 API Key')
      return
    }

    setError('')
    setSavedMsg('')
    pipelineRef.current.abortFlag = false
    setPipeline({ stage: 'outline', outline: '', draft: '', review: '', final: '' })
    setContent('')

    // Gather fresh data
    const chars = await getCharactersByProject(id)
    const chaps = await getChaptersByProject(id)
    const summaryChain = await getAllChapterSummaries(id)
    const fullChain = chaps.map((c) => {
      const found = summaryChain.find((s) => s.chapter?.id === c.id || s.chapterId === c.id)
      return { chapter: c, summary: found?.summary || null }
    })
    const proj = await getProject(id)
    const plotArcs = await getOpenPlotArcs(id)

    let aborted = false

    // --- Stage 1: Detailed Outline ---
    const outlinePrompt = buildDetailedOutlinePrompt(proj, chars, fullChain, selected)
    let outlineText = ''
    await streamChat(
      [
        { role: 'system', content: '你是一位专业小说策划，用中文回复。' },
        { role: 'user', content: outlinePrompt },
      ],
      {
        apiKey: key,
        temperature: 0.7,
        maxTokens: 1024,
        onChunk(chunk) {
          outlineText += chunk
          setPipeline((p) => ({ ...p, outline: outlineText }))
        },
        onDone() {},
        onError(err) {
          setError('大纲生成失败: ' + err)
          aborted = true
        },
      }
    )

    if (aborted || pipelineRef.current.abortFlag) {
      setPipeline((p) => ({ ...p, stage: 'done' }))
      return
    }
    setContent(outlineText)

    // --- Stage 2: Draft ---
    setPipeline((p) => ({ ...p, stage: 'draft' }))
    const draftPrompt = buildDraftPrompt(proj, chars, fullChain, selected, outlineText)
    let draftText = ''
    await streamChat(
      [
        { role: 'system', content: '你是一位专业小说作家，用中文回复。' },
        { role: 'user', content: draftPrompt },
      ],
      {
        apiKey: key,
        temperature: 0.85,
        maxTokens: 8192,
        onChunk(chunk) {
          draftText += chunk
          setPipeline((p) => ({ ...p, draft: draftText }))
          setContent(draftText)
        },
        onDone() {},
        onError(err) {
          setError('草稿生成失败: ' + err)
          aborted = true
        },
      }
    )

    if (aborted || pipelineRef.current.abortFlag) {
      setPipeline((p) => ({ ...p, stage: 'done' }))
      return
    }

    // --- Stage 3: Consistency Review ---
    setPipeline((p) => ({ ...p, stage: 'review' }))
    const reviewPrompt = buildConsistencyReviewPrompt(proj, chars, fullChain, selected, draftText, plotArcs)
    let reviewText = ''
    await streamChat(
      [
        { role: 'system', content: '你是一位严谨的小说审校编辑，用中文回复。' },
        { role: 'user', content: reviewPrompt },
      ],
      {
        apiKey: key,
        temperature: 0.3,
        maxTokens: 2048,
        onChunk(chunk) {
          reviewText += chunk
          setPipeline((p) => ({ ...p, review: reviewText }))
        },
        onDone() {},
        onError() {
          reviewText = '审校服务暂不可用，自动通过。'
          setPipeline((p) => ({ ...p, review: reviewText }))
        },
      }
    )

    if (aborted || pipelineRef.current.abortFlag) {
      setPipeline((p) => ({ ...p, stage: 'done' }))
      return
    }

    // --- Stage 4: Polish ---
    setPipeline((p) => ({ ...p, stage: 'polish' }))
    const polishPrompt = buildPolishPrompt(draftText, reviewText)
    let finalText = ''
    await streamChat(
      [
        { role: 'system', content: '你是一位专业小说润色编辑，用中文回复。' },
        { role: 'user', content: polishPrompt },
      ],
      {
        apiKey: key,
        temperature: 0.6,
        maxTokens: 8192,
        onChunk(chunk) {
          finalText += chunk
          setPipeline((p) => ({ ...p, final: finalText }))
          setContent(finalText)
        },
        onDone() {},
        onError() {
          finalText = draftText
          setPipeline((p) => ({ ...p, final: finalText }))
          setContent(finalText)
          setError('润色失败，已退回草稿版本')
        },
      }
    )

    setPipeline((p) => ({ ...p, stage: 'done' }))
    editorRef.current?.focus()
  }

  const handleSave = async () => {
    if (!selected || saving) return
    setSaving(true)
    setError('')
    try {
      await updateChapterContent(selected.id, content)
      setChapters((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? { ...c, content, status: content ? 'draft' : c.status }
            : c
        )
      )
      setSavedMsg('已保存')

      // Auto-extract structured summary after save
      if (content) {
        try {
          const proj = await getProject(id)
          const summaryPrompt = buildChapterSummaryPrompt(proj, selected, content)
          const summaryMessages = [
            { role: 'system', content: '你是小说分析助手，始终返回严格 JSON，不要加额外文字。' },
            { role: 'user', content: summaryPrompt },
          ]
          const apiKey = await getSetting('apiKey')
          const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'deepseek-v4-flash',
              messages: summaryMessages,
              temperature: 0.3,
              max_tokens: 1024,
              stream: false,
            }),
          })
          const data = await resp.json()
          const raw = data.choices?.[0]?.message?.content || ''
          const parsed = parseChapterSummaryJSON(raw)
          if (parsed) {
            await saveChapterSummary(selected.id, parsed)
            if (parsed.foreshadowing && parsed.foreshadowing !== '无') {
              await savePlotArc({
                projectId: Number(id),
                type: 'foreshadowing',
                description: `第${selected.number}章：${parsed.foreshadowing}`,
                status: 'open',
                relatedChapter: selected.number,
              })
            }
          }
        } catch {
          // Summary extraction is non-blocking
        }
      }

      setTimeout(() => setSavedMsg(''), 2000)
    } catch (err) {
      setError('保存失败: ' + err.message)
    }
    setSaving(false)
  }

  const handleAbort = () => {
    pipelineRef.current.abortFlag = true
    setPipeline((p) => ({ ...p, stage: 'done' }))
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
                placeholder={pipeline.stage !== 'idle' && pipeline.stage !== 'done' ? 'AI 正在生成...' : '选择左侧章节，点击「流水线生成」按钮让 AI 开始写作，或直接在此输入文本...'}
                style={{
                  flex: 1,
                  resize: 'none',
                  minHeight: 0,
                  lineHeight: 1.9,
                  fontSize: 15,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", serif',
                }}
                disabled={pipeline.stage !== 'idle' && pipeline.stage !== 'done'}
              />

              {/* Pipeline progress bar */}
              {pipeline.stage !== 'idle' && pipeline.stage !== 'done' && (
                <div className="pipeline-bar">
                  {['outline', 'draft', 'review', 'polish'].map((stage) => {
                    const labels = { outline: '大纲', draft: '草稿', review: '审校', polish: '润色' }
                    const order = ['outline', 'draft', 'review', 'polish']
                    const currentIdx = order.indexOf(pipeline.stage)
                    const thisIdx = order.indexOf(stage)
                    let cls = 'pipeline-step'
                    if (thisIdx < currentIdx) cls += ' done'
                    if (thisIdx === currentIdx) cls += ' active'
                    return (
                      <div key={stage} className={cls}>
                        <span className="pipeline-dot">{thisIdx < currentIdx ? '✓' : thisIdx + 1}</span>
                        <span className="pipeline-label">{labels[stage]}</span>
                      </div>
                    )
                  })}
                  <button className="btn btn-danger btn-sm" onClick={handleAbort} style={{ marginLeft: 12 }}>
                    中止
                  </button>
                </div>
              )}

              {/* Intermediate results toggle */}
              {pipeline.stage === 'done' && pipeline.outline && (
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888' }}>
                    查看中间结果（大纲 / 审校）
                  </summary>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                    <p><strong>详细大纲：</strong></p>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{pipeline.outline}</pre>
                    <p><strong>审校意见：</strong></p>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{pipeline.review}</pre>
                  </div>
                </details>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexShrink: 0 }}>
                <button
                  className="btn btn-primary"
                  onClick={runPipeline}
                  disabled={pipeline.stage !== 'idle' && pipeline.stage !== 'done'}
                >
                  {pipeline.stage !== 'idle' && pipeline.stage !== 'done' ? '生成中...' : '🚀 流水线生成'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || (pipeline.stage !== 'idle' && pipeline.stage !== 'done')}
                >
                  {saving ? '保存中...' : '💾 保存'}
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
