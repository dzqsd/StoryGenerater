import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProject, getChaptersByProject } from '../db'

export default function ReadPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const topRef = useRef(null)

  const [project, setProject] = useState(null)
  const [chapters, setChapters] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)

  useEffect(() => {
    (async () => {
      const p = await getProject(id)
      if (!p) { navigate('/'); return }
      setProject(p)
      const chaps = (await getChaptersByProject(id))
        .filter((c) => c.content)
        .sort((a, b) => a.number - b.number)
      setChapters(chaps)
      if (chaps.length > 0) setCurrentIdx(0)
    })()
  }, [id, navigate])

  const handleExportFull = () => {
    const full = chapters
      .map((c) => `第${c.number}章 ${c.title}\n\n${c.content}`)
      .join('\n\n---\n\n')
    const text = `# ${project.title}\n\n${project.synopsis || ''}\n\n---\n\n${full}`
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.title || '小说'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportChapter = () => {
    const c = chapters[currentIdx]
    if (!c) return
    const text = `第${c.number}章 ${c.title || ''}\n\n${c.content}`
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `第${c.number}章 ${c.title || ''}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const goTo = (idx) => {
    if (idx >= 0 && idx < chapters.length) {
      setCurrentIdx(idx)
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') goTo(currentIdx - 1)
    if (e.key === 'ArrowRight') goTo(currentIdx + 1)
  }

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  if (!project) return <div className="empty-state"><p>加载中...</p></div>

  const totalWords = chapters.reduce((sum, c) => sum + Math.round(c.content.length / 2), 0)
  const current = chapters[currentIdx]

  return (
    <div className="read-page">
      {/* Top toolbar */}
      <div ref={topRef} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}`)}>
          &larr; 返回
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/write`)}>
          写作
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#9A9A9A' }}>
            共 {chapters.length} 章 / 约 {totalWords} 字
          </span>
          <button className="btn btn-secondary btn-sm" onClick={handleExportChapter} disabled={!current}>
            导出本章
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleExportFull} disabled={chapters.length === 0}>
            导出全书
          </button>
        </div>
      </div>

      {/* Book header */}
      <div className="read-header">
        <h1 className="read-title">{project.title || '未命名'}</h1>
        {project.synopsis && <p className="read-meta">{project.synopsis}</p>}
        <div className="read-meta" style={{ marginTop: 4 }}>
          {project.genre || ''}{project.genre && project.setting ? ' · ' : ''}{project.setting || ''}
        </div>
      </div>

      {chapters.length === 0 ? (
        <div className="read-empty">
          <p>还没有已完成的章节内容</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate(`/project/${id}/write`)}>
            去写作
          </button>
        </div>
      ) : (
        <>
          {/* Chapter selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => goTo(currentIdx - 1)}
              disabled={currentIdx <= 0}
            >
              &lt; 上一章
            </button>

            <select
              className="form-select"
              value={currentIdx}
              onChange={(e) => goTo(Number(e.target.value))}
              style={{ width: 'auto', flex: 1, minWidth: 200, maxWidth: 360 }}
            >
              {chapters.map((c, i) => (
                <option key={c.id} value={i}>
                  第{c.number}章 {c.title || '未命名'}
                </option>
              ))}
            </select>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => goTo(currentIdx + 1)}
              disabled={currentIdx >= chapters.length - 1}
            >
              下一章 &gt;
            </button>

            <span style={{ fontSize: 12, color: '#9A9A9A', marginLeft: 8 }}>
              {currentIdx + 1} / {chapters.length}
            </span>
          </div>

          {/* Current chapter */}
          {current && (
            <div className="read-chapter">
              <h2 className="read-chapter-title">第{current.number}章 {current.title || ''}</h2>
              <div className="read-chapter-content">{current.content}</div>
            </div>
          )}

          {/* Bottom navigation */}
          <div className="read-nav">
            <button
              className="btn btn-secondary"
              onClick={() => goTo(currentIdx - 1)}
              disabled={currentIdx <= 0}
            >
              &lt; 上一章
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#7A7A7A' }}>
                {currentIdx + 1} / {chapters.length}
              </span>
            </div>

            <button
              className="btn btn-secondary"
              onClick={() => goTo(currentIdx + 1)}
              disabled={currentIdx >= chapters.length - 1}
            >
              下一章 &gt;
            </button>
          </div>

          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: '#9A9A9A' }}>
            提示：按 &larr; &rarr; 方向键切换章节
          </div>
        </>
      )}
    </div>
  )
}
