import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  const batchRef = useRef({ completed: [], failed: [] })

  const [batch, setBatch] = useState({
    active: false,
    currentIndex: 0,
    total: 0,
  })
  const [batchResult, setBatchResult] = useState(null)

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

  const runBatchPipeline = async () => {
    if (batch.active) return

    const key = await getSetting('apiKey')
    if (!key) {
      setError('请先在设置页面配置 API Key')
      return
    }

    const plannedChapters = chapters.filter((c) => c.status === 'planned')
    if (plannedChapters.length === 0) {
      setError('没有待生成的章节')
      return
    }

    setError('')
    setSavedMsg('')
    setBatchResult(null)
    pipelineRef.current.abortFlag = false
    batchRef.current = { completed: [], failed: [] }

    setBatch({
      active: true,
      currentIndex: 0,
      total: plannedChapters.length,
    })

    const abortController = new AbortController()
    pipelineRef.current.controller = abortController

    // Pre-fetch static data
    const chars = await getCharactersByProject(id)
    const proj = await getProject(id)

    for (let i = 0; i < plannedChapters.length; i++) {
      if (pipelineRef.current.abortFlag || abortController.signal.aborted) break

      const chapter = plannedChapters[i]
      setSelectedId(chapter.id)
      setContent('')
      setPipeline({ stage: 'outline', outline: '', draft: '', review: '', final: '' })
      setBatch((p) => ({ ...p, currentIndex: i }))

      // Fetch per-chapter data (summary chain grows as chapters are saved)
      let chaps, summaryChain, plotArcs
      try {
        ;[chaps, summaryChain, plotArcs] = await Promise.all([
          getChaptersByProject(id),
          getAllChapterSummaries(id),
          getOpenPlotArcs(id),
        ])
      } catch (err) {
        batchRef.current.failed.push({ number: chapter.number, title: chapter.title, error: '数据获取失败: ' + err.message })
        continue
      }

      try {
        const result = await runChapterPipeline({
          project: proj,
          characters: chars,
          chapters: chaps,
          summaryChain,
          targetChapter: chapter,
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

        // Auto-save
        await updateChapterContent(chapter.id, result.final)
        setChapters((prev) =>
          prev.map((c) =>
            c.id === chapter.id ? { ...c, content: result.final, status: 'draft' } : c
          )
        )

        batchRef.current.completed.push({ number: chapter.number, title: chapter.title })

        // Fire-and-forget summary extraction
        extractAndSaveSummary(chapter, result.final, proj, key).catch(() => {})

      } catch (err) {
        if (pipelineRef.current.abortFlag || abortController.signal.aborted) break

        batchRef.current.failed.push({ number: chapter.number, title: chapter.title, error: err.message })
        setError(`第${chapter.number}章 生成失败: ${err.message}`)
      }
    }

    // Batch complete
    setBatch((p) => ({ ...p, active: false }))
    setPipeline((p) => ({ ...p, stage: 'idle' }))
    setBatchResult({
      completed: [...batchRef.current.completed],
      failed: [...batchRef.current.failed],
    })

    const completedCount = batchRef.current.completed.length
    const failedCount = batchRef.current.failed.length
    if (failedCount === 0) {
      setSavedMsg(`批量生成完成！共完成 ${completedCount} 章`)
      showToast('success', `批量生成完成！共 ${completedCount} 章`)
    } else {
      setError(`批量生成完成：成功 ${completedCount} 章，失败 ${failedCount} 章`)
      showToast('info', `批量生成：成功 ${completedCount} 章，失败 ${failedCount} 章`)
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
    if (batch.active) {
      setBatch((p) => ({ ...p, active: false }))
      showToast('info', '已中止批量生成')
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
        <div className="write-chapter-list">
          <div className="write-chapter-list-header">
            <h3>章节列表</h3>
            <span className="write-chapter-count">{chapters.length}</span>
          </div>
          {chapters.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <p style={{ fontSize: 13 }}>还没有章节，先去策划对话中规划章节吧</p>
            </div>
          ) : (
            chapters.map((c) => {
              const st = statusLabel(c.status)
              const isActive = c.id === selectedId
              const isGenerating = batch.active && isActive && pipeline.stage !== 'idle'
              return (
                <div
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className={`write-chapter-item ${isActive ? 'active' : ''}`}
                >
                  <div className="write-chapter-item-top">
                    <span className="write-chapter-num">第{c.number}章</span>
                    {isGenerating ? (
                      <span className="chapter-status status-generating">生成中</span>
                    ) : (
                      <span className={`chapter-status ${st.cls}`}>{st.text}</span>
                    )}
                  </div>
                  <div className="write-chapter-item-title">{c.title || '未命名'}</div>
                  {c.summary && <div className="write-chapter-item-summary">{c.summary.slice(0, 40)}{c.summary.length > 40 ? '...' : ''}</div>}
                  {c.content && (
                    <div className="write-chapter-item-meta">
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

              {/* Batch progress bar */}
              {batch.active && (
                <div className="batch-progress-bar">
                  <span className="batch-progress-info">
                    批量生成中：第 {batch.currentIndex + 1} / {batch.total} 章
                  </span>
                  <span className="batch-progress-stats">
                    {batchRef.current.completed.length > 0 && (
                      <span className="batch-success">已完成 {batchRef.current.completed.length}</span>
                    )}
                    {batchRef.current.failed.length > 0 && (
                      <span className="batch-fail">失败 {batchRef.current.failed.length}</span>
                    )}
                  </span>
                </div>
              )}

              {/* Pipeline progress bar */}
              {pipeline.stage !== 'idle' && pipeline.stage !== 'done' && (
                <div className="pipeline-bar">
                  {batch.active && <span className="batch-chip">批量模式</span>}
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
                    {batch.active ? '中止批量' : '中止'}
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
                    {pipeline.stage !== 'idle' && pipeline.stage !== 'done' ? '生成中...' : 'AI 流水线生成'}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={runBatchPipeline}
                    disabled={batch.active || (pipeline.stage !== 'idle' && pipeline.stage !== 'done') || chapters.filter((c) => c.status === 'planned').length === 0}
                  >
                    {batch.active ? '批量生成中...' : `批量生成 (${chapters.filter((c) => c.status === 'planned').length})`}
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
                  {content ? `约 ${Math.round(content.length / 2)} 字` : ''}
                </span>
              </div>

              {/* Batch result summary */}
              {batchResult && (batchResult.completed.length > 0 || batchResult.failed.length > 0) && (
                <div className="batch-summary" style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    批量生成结果：成功 {batchResult.completed.length} 章
                    {batchResult.failed.length > 0 && <span style={{ color: '#D05858' }}>，失败 {batchResult.failed.length} 章</span>}
                  </div>
                  {batchResult.failed.length > 0 && (
                    <div>
                      {batchResult.failed.map((f) => (
                        <div key={f.number} style={{ fontSize: 12, color: '#D05858', marginTop: 2 }}>
                          第{f.number}章 &laquo;{f.title}&raquo;: {f.error}
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setBatchResult(null)}>
                    关闭
                  </button>
                </div>
              )}
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
