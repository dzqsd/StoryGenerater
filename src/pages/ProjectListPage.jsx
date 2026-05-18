import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllProjects, createProject, deleteProject } from '../db'

export default function ProjectListPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setProjects(await getAllProjects())
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    const id = await createProject(title.trim())
    setTitle('')
    setShowCreate(false)
    setCreating(false)
    navigate(`/project/${id}/chat`)
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除这个项目吗？包括其中的人物和章节数据将一并删除。')) return
    await deleteProject(id)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className="page-title" style={{ margin: 0 }}>📝 我的创作</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          ＋ 新建项目
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="form-group">
            <label className="form-label">项目名称</label>
            <input
              className="form-input"
              placeholder="给你的小说起个名字..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating || !title.trim()}
          >
            {creating ? '创建中...' : '创建并开始对话'}
          </button>
        </div>
      )}

      {projects.length === 0 && !showCreate ? (
        <div className="empty-state">
          <p>还没有创作项目，点击「新建项目」开始吧 ✍️</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div
              key={p.id}
              className="project-card"
              onClick={() => navigate(`/project/${p.id}`)}
            >
              <div className="project-card-body">
                <h3>{p.title}</h3>
                <div className="project-card-meta">
                  <span className={`project-status status-${p.status}`}>
                    {p.status === 'active' ? '创作中' : '已完成'}
                  </span>
                  <span>{new Date(p.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
                {p.synopsis && <p className="project-synopsis">{p.synopsis.slice(0, 100)}...</p>}
              </div>
              <div className="project-card-actions">
                <button className="btn btn-secondary btn-sm"
                  onClick={(e) => { e.stopPropagation(); navigate(`/project/${p.id}/chat`) }}>
                  💬 对话
                </button>
                <button
                  className="btn btn-danger btn-sm"
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
