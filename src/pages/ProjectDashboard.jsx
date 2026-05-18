import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProject, updateProject, deleteProject,
  getCharactersByProject, getChaptersByProject,
  saveCharacter, saveChapter, deleteCharacter, deleteChapter,
} from '../db'
import CharacterCard from '../components/CharacterCard'
import ChapterItem from '../components/ChapterItem'

export default function ProjectDashboard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [showCharForm, setShowCharForm] = useState(false)
  const [charForm, setCharForm] = useState({ name: '', role: '主角', traits: '', background: '' })
  const [showChapForm, setShowChapForm] = useState(false)
  const [chapForm, setChapForm] = useState({ number: 1, title: '', summary: '' })

  const load = async () => {
    const p = await getProject(id)
    if (!p) { navigate('/'); return }
    setProject(p)
    setCharacters(await getCharactersByProject(id))
    setChapters(await getChaptersByProject(id))
  }

  useEffect(() => { load() }, [id, navigate])

  const handleDeleteProject = async () => {
    if (!confirm('确定要删除整个项目吗？此操作不可恢复。')) return
    await deleteProject(id)
    navigate('/')
  }

  const handleSaveEdit = async () => {
    await updateProject(id, editForm)
    setProject({ ...project, ...editForm })
    setEditing(false)
  }

  const handleAddCharacter = async () => {
    if (!charForm.name.trim()) return
    await saveCharacter({ projectId: Number(id), ...charForm })
    setCharForm({ name: '', role: '主角', traits: '', background: '' })
    setShowCharForm(false)
    load()
  }

  const handleDeleteCharacter = async (charId) => {
    await deleteCharacter(charId)
    load()
  }

  const handleAddChapter = async () => {
    if (!chapForm.title.trim()) return
    await saveChapter({ projectId: Number(id), status: 'planned', content: '', ...chapForm })
    setChapForm({ number: (chapters.length || 0) + 1, title: '', summary: '' })
    setShowChapForm(false)
    load()
  }

  const handleDeleteChapter = async (chapId) => {
    await deleteChapter(chapId)
    load()
  }

  const handleExport = () => {
    const full = chapters
      .filter((c) => c.content)
      .sort((a, b) => a.number - b.number)
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

  if (!project) return <div className="empty-state"><p>加载中...</p></div>

  const tabs = [
    { key: 'overview', label: '总览' },
    { key: 'storyline', label: '故事线' },
    { key: 'characters', label: `人物 (${characters.length})` },
    { key: 'chapters', label: `章节 (${chapters.length})` },
  ]

  return (
    <div>
      <div className="dash-header">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <h1 className="page-title" style={{ margin: 0 }}>{project.title}</h1>
        <div className="btn-group" style={{ margin: 0 }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/chat`)}>
            💬 进入对话
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/write`)}>
            ✍️ 进入写作
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={chapters.every((c) => !c.content)}>
            📥 导出 TXT
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDeleteProject}>
            删除项目
          </button>
        </div>
      </div>

      <div className="dash-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`dash-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16 }}>项目信息</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                setEditForm({ title: project.title, genre: project.genre, setting: project.setting, synopsis: project.synopsis })
                setEditing(!editing)
              }}>
                {editing ? '取消' : '编辑'}
              </button>
            </div>
            {editing ? (
              <div>
                <div className="form-group">
                  <label className="form-label">标题</label>
                  <input className="form-input" value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">题材</label>
                  <input className="form-input" placeholder="玄幻/都市/科幻..." value={editForm.genre || ''} onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">世界观/背景</label>
                  <textarea className="form-input" rows={3} value={editForm.setting || ''} onChange={(e) => setEditForm({ ...editForm, setting: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">主线概要</label>
                  <textarea className="form-input" rows={4} value={editForm.synopsis || ''} onChange={(e) => setEditForm({ ...editForm, synopsis: e.target.value })} />
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}>保存</button>
              </div>
            ) : (
              <div className="info-grid">
                <div className="info-item"><span className="info-label">题材</span><span>{project.genre || '未设定'}</span></div>
                <div className="info-item"><span className="info-label">状态</span><span className={`project-status status-${project.status}`}>{project.status === 'active' ? '创作中' : '已完成'}</span></div>
                <div className="info-item"><span className="info-label">背景</span><span className="info-text">{project.setting || '未设定'}</span></div>
                <div className="info-item"><span className="info-label">主线</span><span className="info-text">{project.synopsis || '未设定'}</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Storyline Tab */}
      {tab === 'storyline' && (
        <div>
          {project.synopsis && (
            <div className="storyline-synopsis">
              <div style={{ fontSize: 12, color: '#e94560', fontWeight: 700, marginBottom: 8 }}>📜 主线概要</div>
              {project.synopsis}
            </div>
          )}

          {chapters.length === 0 ? (
            <div className="empty-state">
              <p>还没有章节，先去策划对话中规划剧情吧</p>
            </div>
          ) : (
            <div className="timeline">
              {chapters
                .sort((a, b) => a.number - b.number)
                .map((c) => (
                  <div
                    key={c.id}
                    className={`timeline-node ${c.content ? 'written' : ''}`}
                  >
                    <div className="timeline-node-header">
                      <span style={{ fontSize: 12, color: '#e94560', fontWeight: 700 }}>
                        第{c.number}章
                      </span>
                      <span className="timeline-node-title">{c.title || '未命名'}</span>
                      <span className={`chapter-status ${c.content ? 'status-done' : 'status-planned'}`} style={{ fontSize: 11 }}>
                        {c.content ? '已写' : '待写'}
                      </span>
                    </div>
                    {c.summary && <div className="timeline-node-summary">{c.summary}</div>}
                    {c.content && (
                      <div className="timeline-node-meta">
                        约 {Math.round(c.content.length / 2)} 字
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Characters Tab */}
      {tab === 'characters' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16 }}>人物列表</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCharForm(!showCharForm)}>
              ＋ 添加人物
            </button>
          </div>

          {showCharForm && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">姓名</label>
                <input className="form-input" value={charForm.name} onChange={(e) => setCharForm({ ...charForm, name: e.target.value })} placeholder="输入角色姓名" />
              </div>
              <div className="form-group">
                <label className="form-label">身份</label>
                <select className="form-select" value={charForm.role} onChange={(e) => setCharForm({ ...charForm, role: e.target.value })}>
                  <option>主角</option>
                  <option>配角</option>
                  <option>反派</option>
                  <option>其他</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">性格特质（逗号分隔）</label>
                <input className="form-input" value={charForm.traits} onChange={(e) => setCharForm({ ...charForm, traits: e.target.value })} placeholder="沉稳、机智、重情义" />
              </div>
              <div className="form-group">
                <label className="form-label">背景故事</label>
                <textarea className="form-input" rows={3} value={charForm.background} onChange={(e) => setCharForm({ ...charForm, background: e.target.value })} placeholder="角色的过往经历..." />
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleAddCharacter} disabled={!charForm.name.trim()}>保存人物</button>
            </div>
          )}

          {characters.length === 0 ? (
            <div className="empty-state"><p>还没有人物，去对话中让 AI 帮你设计吧</p></div>
          ) : (
            <div className="char-grid">
              {characters.map((c) => (
                <CharacterCard key={c.id} character={c} onDelete={handleDeleteCharacter} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chapters Tab */}
      {tab === 'chapters' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16 }}>章节列表</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowChapForm(!showChapForm)}>
              ＋ 添加章节
            </button>
          </div>

          {showChapForm && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">章节序号</label>
                <input className="form-input" type="number" value={chapForm.number} onChange={(e) => setChapForm({ ...chapForm, number: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="form-group">
                <label className="form-label">章节标题</label>
                <input className="form-input" value={chapForm.title} onChange={(e) => setChapForm({ ...chapForm, title: e.target.value })} placeholder="输入章节标题" />
              </div>
              <div className="form-group">
                <label className="form-label">章节概要</label>
                <textarea className="form-input" rows={2} value={chapForm.summary} onChange={(e) => setChapForm({ ...chapForm, summary: e.target.value })} placeholder="这一章讲了什么..." />
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleAddChapter} disabled={!chapForm.title.trim()}>保存章节</button>
            </div>
          )}

          {chapters.length === 0 ? (
            <div className="empty-state"><p>还没有章节，去对话中让 AI 帮你规划吧</p></div>
          ) : (
            <div>
              {chapters.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ flex: 1 }}>
                    <ChapterItem
                      chapter={c}
                      onWrite={(chap) => {
                        navigate(`/project/${id}/write`)
                      }}
                      onClick={(chap) => {
                        // Expand to show content
                        const el = document.getElementById(`chapter-content-${chap.id}`)
                        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
                      }}
                    />
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    if (!c.content) return
                    const text = `第${c.number}章 ${c.title || ''}\n\n${c.content}`
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `第${c.number}章 ${c.title || ''}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }} style={{ flexShrink: 0 }} disabled={!c.content}>导出</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteChapter(c.id)} style={{ flexShrink: 0 }}>删</button>
                </div>
              ))}
              {chapters.filter((c) => c.content).map((c) => (
                <div key={`content-${c.id}`} id={`chapter-content-${c.id}`} className="card" style={{ display: 'none', marginTop: 8, marginBottom: 16, whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                  {c.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
