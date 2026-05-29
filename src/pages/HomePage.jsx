import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllProjects, createProject, deleteProject, getChaptersByProject, WORD_COUNT_OPTIONS } from '../db'

export default function HomePage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [targetWordCount, setTargetWordCount] = useState('1200-2000')
  const [creating, setCreating] = useState(false)
  const [showGuide, setShowGuide] = useState(true)

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
    const id = await createProject(title.trim(), targetWordCount)
    setTitle('')
    setTargetWordCount('1200-2000')
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

      {/* Usage Guide */}
      {showGuide && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 className="card-section-title">使用引导</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowGuide(false)}>收起</button>
          </div>

          <p style={{ fontSize: 13, color: '#7A7A7A', lineHeight: 1.7, marginBottom: 16 }}>
            创建项目后，依次使用以下 5 个策划模块完成小说规划。<strong>推荐顺序：世界观 → 人物 → 章节</strong>，
            也可以随时使用「总策划」进行综合性讨论。主线概要（synopsis）在总策划或章节策划中产出。
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {[
              { key: 'general', name: '总策划', icon: '★', desc: '全能顾问。可同时处理世界观、人物、剧情、章节等一切策划需求。适合头脑风暴或综合性问题。', tip: '不知道该找谁聊时，来这里就对了' },
              { key: 'world', name: '世界观', icon: '◎', desc: '设计故事的时代背景、地理环境、势力格局、力量体系等设定。确认后 [SETTING:已确认] 标签会自动保存。', tip: '最先使用，奠定故事的氛围与规则' },
              { key: 'characters', name: '人物', icon: '👤', desc: '创建角色档案（姓名、身份、性格、背景），AI 帮你丰富细节。使用 [CHARACTER] 标签结构化输出并自动入库。', tip: '世界观之后使用，让角色生长在设定中' },

              { key: 'outline', name: '章节', icon: '≡', desc: '将主线拆分为具体的章节序列，每章有标题和概要。使用 [CHAPTERS] 标签输出，在仪表盘可视化展示。', tip: '关注"故事怎么分章"，是写作前的最后一步' },
              { key: 'revision', name: '修订', icon: '✎', desc: '对已完成章节进行回顾讨论，获取改进建议。无结构化数据输出，侧重自由讨论。', tip: '写作过程中随时回来检视' },
            ].map((m) => (
              <div key={m.key} style={{ background: '#F4F2EC', borderRadius: 8, padding: '14px 16px', border: '1px solid #E5DFD3' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 6, background: '#6B74A8', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{m.icon}</span>
                  <span style={{ fontFamily: 'Archivo, sans-serif', fontSize: 14, fontWeight: 700, color: '#3A3A3A' }}>{m.name}</span>
                </div>
                <p style={{ fontSize: 12, color: '#5A5A5A', lineHeight: 1.65, marginBottom: 8 }}>{m.desc}</p>
                <p style={{ fontSize: 11, color: '#9A9A9A', lineHeight: 1.4, fontStyle: 'italic' }}>{m.tip}</p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: '12px 16px', background: '#EEECDF', borderRadius: 8, border: '1px solid #D8D3CA' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B74A8' }}>写作流程：</span>
            <span style={{ fontSize: 12, color: '#7A7A7A', lineHeight: 1.7 }}>
              {' '}策划完成后，进入「写作」页面，选择章节启动 AI 四阶段流水线：
              <strong>详细大纲</strong> → <strong>初稿</strong> → <strong>一致性审查</strong> → <strong>润色</strong>。
              支持单章生成和批量生成，审查阶段会自动检查与前文的连贯性和伏笔回收。
            </span>
          </div>
        </div>
      )}

      {!showGuide && (
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowGuide(true)}>展开使用引导</button>
        </div>
      )}

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
          <div className="form-group">
            <label className="form-label">每章目标字数</label>
            <select
              className="form-select"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(e.target.value)}
            >
              {WORD_COUNT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
          <p className="home-empty-desc">创建项目后，AI 将协助你完成世界观、人物和章节的全流程策划</p>
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
