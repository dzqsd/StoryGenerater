import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllProjects, createProject, deleteProject, getChaptersByProject } from '../db'

export default function HomePage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    const all = await getAllProjects()
    // Attach chapter counts
    const enriched = await Promise.all(
      all.map(async (p) => {
        try {
          const chaps = await getChaptersByProject(p.id)
          const written = chaps.filter((c) => c.content).length
          return { ...p, _totalChapters: chaps.length, _writtenChapters: written }
        } catch {
          return { ...p, _totalChapters: 0, _writtenChapters: 0 }
        }
      })
    )
    setProjects(enriched)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    const id = await createProject(title.trim())
    setTitle('')
    setShowCreate(false)
    setCreating(false)
    navigate(`/project/${id}/general`)
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除这个项目吗？包括其中的人物和章节数据将一并删除。')) return
    await deleteProject(id)
    load()
  }

  const activeCount = projects.filter((p) => p.status === 'active').length

  return (
    <div className="home-page">
      {/* Header */}
      <div className="home-header">
        <div className="home-header-left">
          <h1 className="home-title">小说工坊</h1>
          <p className="home-tagline">你的 AI 创作空间</p>
        </div>
        <div className="home-header-right">
          {projects.length > 0 && (
            <span className="home-stat">{projects.length} 个项目 · {activeCount} 个进行中</span>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + 新建项目
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card home-create-card">
          <div className="form-group">
            <label className="form-label">给你的作品起个名字</label>
            <input
              className="form-input"
              placeholder="例：星辰剑帝、末世求生录..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <div className="btn-group">
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={creating || !title.trim()}
            >
              {creating ? '创建中...' : '创建并开始策划'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 && !showCreate ? (
        <div className="home-empty">
          <div className="home-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6B74A8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </div>
          <h3 className="home-empty-title">开始你的第一部作品</h3>
          <p className="home-empty-desc">创建项目后，AI 将协助你完成世界观、人物、剧情和大纲的全流程策划</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + 新建项目
          </button>
        </div>
      ) : (
        <div className="home-project-list">
          {projects.map((p) => (
            <div
              key={p.id}
              className="home-project-row"
              onClick={() => navigate(`/project/${p.id}`)}
            >
              <div className="home-project-main">
                <div className="home-project-top">
                  <h3 className="home-project-title">{p.title}</h3>
                  <span className={`project-status status-${p.status}`}>
                    {p.status === 'active' ? '创作中' : '已完成'}
                  </span>
                </div>
                <div className="home-project-meta">
                  {p.genre && <span className="home-project-genre">{p.genre}</span>}
                  {p._totalChapters > 0 && (
                    <span className="home-project-chapters">
                      已写 {p._writtenChapters}/{p._totalChapters} 章
                    </span>
                  )}
                  <span>{new Date(p.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                {p.synopsis && (
                  <p className="home-project-synopsis">{p.synopsis.slice(0, 120)}{p.synopsis.length > 120 ? '...' : ''}</p>
                )}
              </div>
              <div className="home-project-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={(e) => { e.stopPropagation(); navigate(`/project/${p.id}`) }}
                >
                  进入
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
