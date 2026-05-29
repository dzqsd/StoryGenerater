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
  createSnapshot, getSnapshotsByChapter, cleanupSnapshots,
  getWordCountConfig,
} from '../db'
import { runChapterPipeline, extractAndSaveSummary, reanalyzeAllChapters } from '../utils/chapterPipeline'
import { countWords } from '../utils/wordCount'

function computeDiff(current, historical) {
  const curLines = (current || '').split('\n')
  const histLines = (historical || '').split('\n')
  const maxLen = Math.max(curLines.length, histLines.length)
  let html = ''
  for (let i = 0; i < maxLen; i++) {
    const cur = curLines[i] || ''
    const hist = histLines[i] || ''
    if (cur === hist) {
      html += `<span>${esc(cur)}</span>\n`
    } else {
      if (hist) html += `<span style="background:rgba(200,80,80,0.2);color:#c85050">-${esc(hist)}</span>\n`
      if (cur) html += `<span style="background:rgba(80,180,80,0.2);color:#50a050">+${esc(cur)}</span>\n`
    }
  }
  return html
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
  const lastSnapshotRef = useRef(null)
  const snapshotTimerRef = useRef(null)
  const [showHistory, setShowHistory] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [diffTarget, setDiffTarget] = useState(null)
  const [diffContent, setDiffContent] = useState('')
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeProgress, setReanalyzeProgress] = useState('')
  const [chapterJumpInput, setChapterJumpInput] = useState('')
  const [filterKeyOnly, setFilterKeyOnly] = useState(false)
  const [showBatchExport, setShowBatchExport] = useState(false)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')

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

  const filteredChapters = filterKeyOnly ? chapters.filter((c) => c.isKeyChapter) : chapters

  const handleChapterJump = () => {
    const num = parseInt(chapterJumpInput)
    if (!num) return
    const target = chapters.find((c) => c.number === num)
    if (target) {
      handleSelect(target)
      setChapterJumpInput('')
    } else {
      showToast('error', `未找到第${num}章`)
    }
  }

  const chapterListRef = useRef(null)

  // Auto-snapshot timer (every 5 minutes)
  useEffect(() => {
    if (!selected) return
    snapshotTimerRef.current = setInterval(async () => {
      const currentContent = content
      if (!currentContent) return
      const lastContent = lastSnapshotRef.current
      if (currentContent !== lastContent) {
        await createSnapshot(selected.id, currentContent)
        lastSnapshotRef.current = currentContent
        await cleanupSnapshots(selected.id)
      }
    }, 5 * 60 * 1000)

    return () => {
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current)
    }
  }, [selected, content])

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
        wordCount: getWordCountConfig(proj.targetWordCount),
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
      lastSnapshotRef.current = result.final

      // Auto-save draft
      try {
        await updateChapterContent(selected.id, result.final, 'draft')
        await createSnapshot(selected.id, result.final)
        setChapters((prev) =>
          prev.map((c) =>
            c.id === selected.id ? { ...c, content: result.final, status: 'draft' } : c
          )
        )
        savedContentRef.current = result.final
        showToast('success', '已自动保存草稿')
        extractAndSaveSummary(selected, result.final, proj, key)
      } catch {
        // Save failure is non-fatal
      }

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
      // 保存时创建快照
      if (content) {
        await createSnapshot(selected.id, content)
        lastSnapshotRef.current = content
        await cleanupSnapshots(selected.id)
      }

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

  const handleReanalyzeAll = async () => {
    const key = await getSetting('apiKey')
    if (!key) { setError('请先在设置页面配置 API Key'); return }
    setReanalyzing(true)
    setError('')
    try {
      const result = await reanalyzeAllChapters(chapters, project, key, (cur, total, title) => {
        setReanalyzeProgress(`正在分析第 ${cur}/${total} 章「${title}」...`)
      })
      setReanalyzeProgress('')
      showToast('success', `分析完成！已分析 ${result.analyzed} 章，识别 ${result.keyChapters} 个关键章节${result.errors > 0 ? `，${result.errors} 个失败` : ''}`)
      // Reload chapters to pick up isKeyChapter flags
      const chaps = await getChaptersByProject(id)
      setChapters(chaps)
    } catch (e) {
      setError('分析失败: ' + e.message)
    } finally {
      setReanalyzing(false)
    }
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

  const handleBatchExport = () => {
    const from = parseInt(exportFrom)
    const to = parseInt(exportTo)
    if (!from || !to || from > to) {
      showToast('error', '请输入有效的起止章节号（起始 ≤ 结束）')
      return
    }
    const range = chapters
      .filter((c) => c.number >= from && c.number <= to)
      .sort((a, b) => a.number - b.number)
    if (range.length === 0) {
      showToast('error', '指定范围内没有章节')
      return
    }
    const text = range
      .map((c) => `第${c.number}章 ${c.title || ''}\n\n${c.content || '（暂无内容）'}\n\n${'─'.repeat(40)}\n`)
      .join('\n')
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.title || '导出'}_第${from}-${to}章.txt`
    a.click()
    URL.revokeObjectURL(url)
    setShowBatchExport(false)
    showToast('success', `已导出第${from}-${to}章（${range.length}章）`)
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

      {/* Batch Export Modal */}
      {showBatchExport && (
        <div className="modal-overlay" onClick={() => setShowBatchExport(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>批量导出章节</h3>
              <button className="modal-close" onClick={() => setShowBatchExport(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="batch-export-row">
                <label>起始章节：</label>
                <input
                  className="form-input batch-export-input"
                  type="number"
                  min="1"
                  value={exportFrom}
                  onChange={(e) => setExportFrom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleBatchExport() }}
                  autoFocus
                />
              </div>
              <div className="batch-export-row">
                <label>结束章节：</label>
                <input
                  className="form-input batch-export-input"
                  type="number"
                  min="1"
                  value={exportTo}
                  onChange={(e) => setExportTo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleBatchExport() }}
                />
              </div>
              <div className="batch-export-hint">
                当前共有 {chapters.length} 章（第{Math.min(...chapters.map(c => c.number)) || 0}-{Math.max(...chapters.map(c => c.number)) || 0}章）
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBatchExport(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleBatchExport}>导出 TXT</button>
            </div>
          </div>
        </div>
      )}

      <div className="write-toolbar">
        <div className="write-toolbar-left">
          <h2 className="write-project-title">{project.title}</h2>
          <span className="write-mode-badge">写作模式</span>
          {(() => {
            const totalWords = chapters.reduce((sum, c) => sum + countWords(c.content || ''), 0)
            if (totalWords > 250000) {
              return <span className="write-mode-badge" style={{ background: '#F0E6D3', color: '#8B6914' }} title="已触发滑动窗口，摘要链仅保留最近30章+关键章节">窗口模式</span>
            }
            return <span className="write-mode-badge" style={{ background: '#E8EDF0', color: '#5A7A8A' }}>约 {totalWords.toLocaleString()} 字</span>
          })()}
        </div>
        <div className="write-toolbar-right">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowOutline(!showOutline)}>
            {showOutline ? '隐藏大纲' : '显示大纲'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/read`)}>
            阅读模式
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              if (!showHistory) {
                const snaps = await getSnapshotsByChapter(selected.id)
                setSnapshots(snaps)
              }
              setShowHistory(!showHistory)
              setDiffTarget(null)
            }}
          >
            {showHistory ? '关闭历史' : '历史版本'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleReanalyzeAll}
            disabled={reanalyzing}
          >
            {reanalyzing ? '分析中...' : '分析关键章节'}
          </button>
        </div>
      </div>

      {reanalyzeProgress && (
        <div style={{ padding: '6px 12px', background: '#F4F2EC', borderRadius: 6, fontSize: 12, color: '#6B74A8', marginBottom: 8 }}>
          {reanalyzeProgress}
        </div>
      )}

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
            <span className="write-chapter-count">{filteredChapters.length}</span>
          </div>
          <div className="write-chapter-filters">
            <div className="write-chapter-jump-row">
              <input
                className="write-chapter-jump-input"
                type="number"
                placeholder="输入章节号..."
                value={chapterJumpInput}
                onChange={(e) => setChapterJumpInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleChapterJump() }}
              />
              <button className="btn btn-secondary btn-sm" onClick={handleChapterJump}>跳转</button>
            </div>
            <button
              className={`btn btn-sm ${filterKeyOnly ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterKeyOnly(!filterKeyOnly)}
              style={{ whiteSpace: 'nowrap' }}
            >
              {filterKeyOnly ? '显示全部' : '关键章节'}
            </button>
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
          ) : filteredChapters.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <p style={{ fontSize: 13 }}>没有匹配的章节</p>
            </div>
          ) : (
            filteredChapters.map((c) => {
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
                  <div className="write-chapter-item-title">
                    {c.title || '未命名'}
                    {c.isKeyChapter && <span title={c.keyReason || '关键章节'} style={{ color: '#E8A838', marginLeft: 4, fontSize: 12 }}>★</span>}
                  </div>
                  {c.summary && <div className="write-chapter-item-summary">{c.summary.slice(0, 40)}{c.summary.length > 40 ? '...' : ''}</div>}
                  {c.content && (
                    <div className="write-chapter-item-meta">
                      约 {countWords(c.content)} 字
                      {c.updatedAt && (
                        <span style={{ marginLeft: 8, color: '#9A9A9A' }}>
                          {new Date(c.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
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
                      <span className="outline-item-title">
                        {c.title || '未命名'}
                        {c.isKeyChapter && <span title={c.keyReason || '关键章节'} style={{ color: '#E8A838', marginLeft: 3, fontSize: 11 }}>★</span>}
                      </span>
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
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const nums = chapters.map((c) => c.number).sort((a, b) => a - b)
                    setExportFrom(nums[0]?.toString() || '')
                    setExportTo(nums[nums.length - 1]?.toString() || '')
                    setShowBatchExport(true)
                  }}
                >
                  批量导出
                </button>
                <span className="write-word-count">
                  {content ? `约 ${countWords(content)} 字` : ''}
                </span>
              </div>

              {/* History panel */}
              {showHistory && (
                <div className="history-panel">
                  <div className="history-panel-header">
                    <span>历史版本 ({snapshots.length})</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(false)}>×</button>
                  </div>
                  {snapshots.length === 0 ? (
                    <div className="empty-state" style={{ padding: 16 }}>
                      <p style={{ fontSize: 13 }}>暂无快照</p>
                    </div>
                  ) : (
                    <div className="history-list">
                      {snapshots.map((snap) => (
                        <div
                          key={snap.id}
                          className={`history-item ${diffTarget?.id === snap.id ? 'active' : ''}`}
                          onClick={async () => {
                            setDiffTarget(snap)
                            setDiffContent(computeDiff(content, snap.content))
                          }}
                        >
                          <div className="history-item-time">
                            {new Date(snap.createdAt).toLocaleString('zh-CN')}
                          </div>
                          <div className="history-item-words">约 {snap.wordCount} 字</div>
                          <div className="history-item-preview">
                            {snap.content.slice(0, 50)}{snap.content.length > 50 ? '...' : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {diffTarget && (
                    <div className="history-diff">
                      <div className="history-diff-header">
                        <span>对比：当前 vs {new Date(diffTarget.createdAt).toLocaleString('zh-CN')}</span>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={async () => {
                            if (!confirm('确定要恢复到此版本吗？当前内容将被替换。')) return
                            setContent(diffTarget.content)
                            await updateChapterContent(selected.id, diffTarget.content, selected.status)
                            setShowHistory(false)
                            setDiffTarget(null)
                          }}
                        >
                          恢复此版本
                        </button>
                      </div>
                      <pre className="history-diff-content" dangerouslySetInnerHTML={{ __html: diffContent }} />
                    </div>
                  )}
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
