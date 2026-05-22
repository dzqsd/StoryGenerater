import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  getProject,
  getCharactersByProject,
  getChaptersByProject,
  updateChapterContent,
  getSetting,
  getAllChapterSummaries,
  getOpenPlotArcs,
} from '../db'
import { runChapterPipeline, extractAndSaveSummary } from '../utils/chapterPipeline'
import { countWords } from '../utils/wordCount'

export default function WritePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const editorRef = useRef(null)

  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const showToast = useCallback((type, message, duration = 2500) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ type, message })
    toastTimer.current = setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, duration)
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
    toastTimer.current = null
  }, [])
  const [showOutline, setShowOutline] = useState(true)
  const [pipeline, setPipeline] = useState({
    stage: 'idle',
    outline: '',
    draft: '',
    review: '',
    final: '',
  })
  const pipelineRef = useRef({ abortFlag: false, controller: null })
  const savedContentRef = useRef('')

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e) => {
      if (content !== savedContentRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [content])

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
  }, [id, location.key])

  const selected = chapters.find((c) => c.id === selectedId)
  const chapterListRef = useRef(null)

  // Auto-scroll chapter list to selected chapter
  useEffect(() => {
    if (selectedId && chapterListRef.current) {
      const el = chapterListRef.current.querySelector(`[data-chapter-id="${selectedId}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [selectedId])

  const handleSelect = (chap) => {
    setSelectedId(chap.id)
    const c = chap.content || ''
    setContent(c)
    savedContentRef.current = c
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

    const [chars, chaps, summaryChain, proj, plotArcs] = await Promise.all([
      getCharactersByProject(id),
      getChaptersByProject(id),
      getAllChapterSummaries(id),
      getProject(id),
      getOpenPlotArcs(id),
    ])

    const abortController = new AbortController()
    pipelineRef.current.controller = abortController

    try {
      const result = await runChapterPipeline({
        project: proj,
        characters: chars,
        chapters: chaps,
        summaryChain,
        targetChapter: selected,
        plotArcs,
        apiKey: key,
        onStageChange: (stage) => setPipeline((p) => ({ ...p, stage })),
        onOutput: (stage, text) => {
          setPipeline((p) => ({ ...p, [stage]: text }))
          if (stage === 'draft' || stage === 'final') {
            setContent(text)
          }
        },
        signal: abortController.signal,
      })

      setPipeline((p) => ({ ...p, stage: 'done' }))
      setContent(result.final)
      editorRef.current?.focus()
    } catch (err) {
      setError(err.message)
      setPipeline((p) => ({ ...p, stage: 'idle' }))
    }
  }

  const handleSave = async (targetStatus) => {
    const finalStatus = targetStatus || 'draft'
    if (!selected || saving) return
    setSaving(true)
    setError('')
    setSavedMsg('')
    try {
      await updateChapterContent(selected.id, content, finalStatus)
      setChapters((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? { ...c, content, status: content ? finalStatus : c.status }
            : c
        )
      )
      const label = finalStatus === 'done' ? '已定稿' : '已保存'
      setSavedMsg(label)
      savedContentRef.current = content
      showToast('success', finalStatus === 'done' ? '章节已定稿 ✓' : '草稿已保存 ✓')

      // Auto-extract structured summary after save
      if (content) {
        try {
          const proj = await getProject(id)
          const apiKey = await getSetting('apiKey')
          await extractAndSaveSummary(selected, content, proj, apiKey)
        } catch {
          // Summary extraction is non-blocking
        }
      }

      setTimeout(() => setSavedMsg(''), 2000)
    } catch (err) {
      const msg = '保存失败: ' + err.message
      setError(msg)
      showToast('error', msg)
    }
    setSaving(false)
  }

  const handleAbort = () => {
    pipelineRef.current.abortFlag = true
    if (pipelineRef.current.controller) {
      pipelineRef.current.controller.abort()
      pipelineRef.current.controller = null
    }
    setPipeline((p) => ({ ...p, stage: 'idle' }))
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
      {/* Toast notification */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span className="toast-icon">
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
            </span>
            <span className="toast-msg">{toast.message}</span>
            <button className="toast-close" onClick={dismissToast}>×</button>
          </div>
        </div>
      )}
      <div className="write-toolbar">
        <div className="write-toolbar-left">
          <h2 className="write-project-title">{project.title}</h2>
          <span className="write-mode-badge">写作模式</span>
        </div>
        <div className="write-toolbar-right">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowOutline(!showOutline)}>
            {showOutline ? '隐藏大纲' : '显示大纲'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/read`)}>
            阅读模式
          </button>
        </div>
      </div>

      {error && (
        <div className="chat-error" style={{ marginBottom: 12 }}>
          <span>{error}</span>
          <button className="btn btn-sm btn-secondary" onClick={() => setError('')}>关闭</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left: Chapter list */}
        <div className="write-chapter-list" ref={chapterListRef}>
          <div className="write-chapter-list-header">
            <h3>章节列表</h3>
            <span className="write-chapter-count">{chapters.length}</span>
          </div>
          {chapters.length > 0 && (
            <div className="write-chapter-nav">
              <select
                className="write-chapter-jump"
                value={selectedId || ''}
                onChange={(e) => {
                  const chap = chapters.find((c) => c.id === Number(e.target.value))
                  if (chap) handleSelect(chap)
                }}
              >
                <option value="" disabled>跳转到...</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    第{c.number}章 {c.title || '未命名'} {c.content ? '✓' : '○'}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  const next = chapters.find((c) => c.status === 'planned') || chapters.find((c) => c.status === 'draft')
                  if (next) handleSelect(next)
                }}
              >
                下一章待写
              </button>
            </div>
          )}
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
                  data-chapter-id={c.id}
                  onClick={() => handleSelect(c)}
                  className={`write-chapter-item ${isActive ? 'active' : ''}`}
                >
                  <div className="write-chapter-item-top">
                    <span className="write-chapter-num">第{c.number}章</span>
                    <span className={`chapter-status ${st.cls}`}>{st.text}</span>
                  </div>
                  <div className="write-chapter-item-title">{c.title || '未命名'}</div>
                  {c.summary && <div className="write-chapter-item-summary">{c.summary.slice(0, 40)}{c.summary.length > 40 ? '...' : ''}</div>}
                  {c.content && (
                    <div className="write-chapter-item-meta">
                      约 {countWords(c.content)} 字
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
                  <div className="outline-panel-header">章节大纲</div>
                  {chapters.map((c) => (
                    <div
                      key={c.id}
                      className={`outline-item ${c.id === selectedId ? 'active' : ''}`}
                      onClick={() => handleSelect(c)}
                    >
                      <span className="outline-item-num">第{c.number}章</span>
                      <span className="outline-item-title">{c.title || '未命名'}</span>
                      {c.summary && <span className="outline-item-summary">{c.summary.slice(0, 20)}{c.summary.length > 20 ? '...' : ''}</span>}
                      <span className={`chapter-status ${statusLabel(c.status).cls}`}>{statusLabel(c.status).text}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="write-editor-header">
                <div className="write-editor-title-row">
                  <span className="write-editor-chapter-title">
                    第{selected.number}章 {selected.title || '未命名'}
                  </span>
                  <span className={`chapter-status ${statusLabel(selected.status).cls}`}>
                    {statusLabel(selected.status).text}
                  </span>
                  {savedMsg && <span className="write-saved-msg">{savedMsg}</span>}
                </div>
                {selected.summary && (
                  <div className="write-summary-box">
                    <span className="write-summary-label">本章概要</span>
                    {selected.summary}
                  </div>
                )}
              </div>

              <textarea
                ref={editorRef}
                className="form-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={pipeline.stage !== 'idle' && pipeline.stage !== 'done' ? 'AI 正在生成...' : '选择左侧章节，点击「AI 生成本章」按钮让 AI 开始写作，或直接在此输入文本...'}
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
                <details className="write-intermediate">
                  <summary>查看中间结果（大纲 / 审校）</summary>
                  <div className="write-intermediate-content">
                    <p><strong>详细大纲：</strong></p>
                    <pre>{pipeline.outline}</pre>
                    <p><strong>审校意见：</strong></p>
                    <pre>{pipeline.review}</pre>
                  </div>
                </details>
              )}

              {/* Save progress bar */}
              {saving && (
                <div className="save-progress">
                  <div className="save-progress-bar" />
                </div>
              )}

              <div className="write-action-bar">
                <div className="write-action-group">
                  <button
                    className="btn btn-primary"
                    onClick={runPipeline}
                    disabled={pipeline.stage !== 'idle' && pipeline.stage !== 'done'}
                  >
                    {pipeline.stage !== 'idle' && pipeline.stage !== 'done' ? '生成中...' : 'AI 生成本章'}
                  </button>
                </div>
                <div className="write-action-divider" />
                <div className="write-action-group">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleSave('draft')}
                    disabled={saving || (pipeline.stage !== 'idle' && pipeline.stage !== 'done') || !content}
                  >
                    {saving ? '保存中...' : '保存草稿'}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleSave('done')}
                    disabled={saving || (pipeline.stage !== 'idle' && pipeline.stage !== 'done') || !content}
                    style={{ background: '#5A966E', borderColor: '#5A966E' }}
                  >
                    定稿
                  </button>
                </div>
                <div className="write-action-divider" />
                <button
                  className="btn btn-secondary"
                  onClick={handleExportChapter}
                  disabled={!content}
                >
                  导出本章
                </button>
                <span className="write-word-count">
                  {content ? `约 ${countWords(content)} 字` : ''}
                </span>
              </div>

            </>
          ) : (
            <div className="empty-state">
              <p>请先在策划对话中规划章节，然后选择左侧章节开始写作</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
