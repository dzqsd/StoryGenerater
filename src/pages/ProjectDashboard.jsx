import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProject, updateProject, deleteProject,
  getCharactersByProject, getChaptersByProject,
  saveCharacter, saveChapter, deleteCharacter, deleteChapter,
  getPlotArcsByProject, updatePlotArcStatus, deletePlotArc,
  savePlotArc,
} from '../db'
import { countWords } from '../utils/wordCount'
import CharacterCard from '../components/CharacterCard'
import ChapterItem from '../components/ChapterItem'

export default function ProjectDashboard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [characters, setCharacters] = useState([])
  const [chapters, setChapters] = useState([])
  const [plotArcs, setPlotArcs] = useState([])
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [showCharForm, setShowCharForm] = useState(false)
  const [charForm, setCharForm] = useState({ name: '', role: '主角', traits: '', background: '' })
  const [showChapForm, setShowChapForm] = useState(false)
  const [chapForm, setChapForm] = useState({ number: 1, title: '', summary: '' })
  const [showArcForm, setShowArcForm] = useState(false)
  const [arcForm, setArcForm] = useState({ type: 'foreshadowing', description: '' })
  const [editingWorld, setEditingWorld] = useState(false)
  const [worldForm, setWorldForm] = useState({ genre: '', setting: '' })
  const [showTimeline, setShowTimeline] = useState(true)
  const [expandedChapterId, setExpandedChapterId] = useState(null)
  const [outlinePage, setOutlinePage] = useState(1)
  const [timelinePage, setTimelinePage] = useState(1)
  const PAGE_SIZE = 6
  const timelineJumpRef = useRef(null)
  const outlineJumpRef = useRef(null)

  const load = async () => {
    const p = await getProject(id)
    if (!p) { navigate('/'); return }
    setProject(p)
    setCharacters(await getCharactersByProject(id))
    setChapters(await getChaptersByProject(id))
    setPlotArcs(await getPlotArcsByProject(id))
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

  const handleAddPlotArc = async () => {
    if (!arcForm.description.trim()) return
    await savePlotArc({ projectId: Number(id), ...arcForm, status: 'open', relatedChapter: 0 })
    setArcForm({ type: 'foreshadowing', description: '' })
    setShowArcForm(false)
    load()
  }

  const handleSaveWorld = async () => {
    await updateProject(id, worldForm)
    setProject({ ...project, ...worldForm })
    setEditingWorld(false)
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
    { key: 'world', label: '世界观' },
    { key: 'characters', label: `人物 (${characters.length})` },
    { key: 'plot', label: `剧情 (${plotArcs.length})` },
    { key: 'outline', label: `章节 (${chapters.length})` },
    { key: 'revision', label: '修订' },
  ]

  return (
    <div>
      <div className="dash-header">
        <h1 className="page-title" style={{ margin: 0 }}>{project.title}</h1>
        <div className="btn-group" style={{ margin: 0 }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/write`)}>
            开始写作
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={chapters.every((c) => !c.content)}>
            导出 TXT
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
            onClick={() => { setTab(t.key); setOutlinePage(1); setTimelinePage(1); setExpandedChapterId(null) }}
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
              <h3 className="card-section-title">项目信息</h3>
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

          <div className="dash-stats-row">
            <div className="dash-stat-card">
              <div className="dash-stat-num">{characters.length}</div>
              <div className="dash-stat-label">人物</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{chapters.length}</div>
              <div className="dash-stat-label">章节</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{plotArcs.length}</div>
              <div className="dash-stat-label">伏笔/冲突</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{chapters.filter((c) => c.content).length}</div>
              <div className="dash-stat-label">已完成</div>
            </div>
          </div>
        </div>
      )}

      {/* World Tab */}
      {tab === 'world' && (
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="card-section-title">世界观设定</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                setWorldForm({ genre: project.genre || '', setting: project.setting || '' })
                setEditingWorld(!editingWorld)
              }}>
                {editingWorld ? '取消' : '编辑'}
              </button>
            </div>
            {editingWorld ? (
              <div>
                <div className="form-group">
                  <label className="form-label">题材</label>
                  <input className="form-input" placeholder="玄幻/都市/科幻/悬疑..." value={worldForm.genre || ''} onChange={(e) => setWorldForm({ ...worldForm, genre: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">世界观描述</label>
                  <textarea className="form-input" rows={5} placeholder="描述时代背景、地理环境、势力格局、力量体系..." value={worldForm.setting || ''} onChange={(e) => setWorldForm({ ...worldForm, setting: e.target.value })} />
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleSaveWorld}>保存</button>
              </div>
            ) : (
              <>
                <div className="world-info-block">
                  <div className="world-info-label">题材</div>
                  <div className="world-info-value">{project.genre || '未设定 — 去世界观策划对话中确定'}</div>
                </div>
                <div className="world-info-block">
                  <div className="world-info-label">世界观</div>
                  <div className="world-info-value">{project.setting || '未设定 — 去世界观策划对话中构建'}</div>
                </div>
              </>
            )}
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#3A3A3A' }}>快捷入口</span>
            </div>
            <div className="btn-group" style={{ margin: 0 }}>
              <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/world`)}>
                世界观策划对话
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/general`)}>
                总策划对话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plot Tab */}
      {tab === 'plot' && (
        <div>
          {project.synopsis && (
            <div className="storyline-synopsis">
              <div className="synopsis-label">主线概要</div>
              {project.synopsis}
            </div>
          )}
          {!project.synopsis && (
            <div className="card" style={{ textAlign: 'center', padding: '24px 20px' }}>
              <p style={{ fontSize: 13, color: '#9A9A9A', marginBottom: 10 }}>还没有主线概要，去剧情策划对话中确定吧</p>
              <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/plot`)}>
                去剧情策划
              </button>
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="card-section-title">伏笔与冲突追踪</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setShowArcForm(!showArcForm)}>
                + 添加
              </button>
            </div>

            {showArcForm && (
              <div style={{ marginBottom: 14, padding: '12px 14px', background: '#F4F2EC', borderRadius: 8 }}>
                <div className="form-group">
                  <label className="form-label">类型</label>
                  <select className="form-select" value={arcForm.type} onChange={(e) => setArcForm({ ...arcForm, type: e.target.value })}>
                    <option value="foreshadowing">伏笔</option>
                    <option value="conflict">冲突</option>
                    <option value="character_arc">角色弧</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">描述</label>
                  <input className="form-input" value={arcForm.description} onChange={(e) => setArcForm({ ...arcForm, description: e.target.value })} placeholder="简要描述这个伏笔或冲突..." onKeyDown={(e) => e.key === 'Enter' && handleAddPlotArc()} />
                </div>
                <div className="btn-group" style={{ margin: 0 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleAddPlotArc} disabled={!arcForm.description.trim()}>添加</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowArcForm(false)}>取消</button>
                </div>
              </div>
            )}

            {plotArcs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <p style={{ fontSize: 13, color: '#9A9A9A' }}>还没有伏笔或冲突，去剧情策划对话中规划吧</p>
              </div>
            ) : (
              plotArcs.map((arc) => (
                <div key={arc.id} className="arc-row">
                  <span className={`arc-type-tag arc-type-${arc.type}`}>
                    {arc.type === 'foreshadowing' ? '伏笔' : arc.type === 'conflict' ? '冲突' : '角色弧'}
                  </span>
                  <span className="arc-desc">{arc.description}</span>
                  <span className={`chapter-status ${arc.status === 'open' ? 'status-planned' : 'status-done'}`}>
                    {arc.status === 'open' ? '未解决' : '已解决'}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      await updatePlotArcStatus(arc.id, arc.status === 'open' ? 'resolved' : 'open')
                      load()
                    }}
                  >
                    {arc.status === 'open' ? '标记解决' : '重新打开'}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      await deletePlotArc(arc.id)
                      load()
                    }}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Outline Tab */}
      {tab === 'outline' && (() => {
        const sorted = [...chapters].sort((a, b) => a.number - b.number)
        const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
        const startIdx = (outlinePage - 1) * PAGE_SIZE
        const pageChapters = sorted.slice(startIdx, startIdx + PAGE_SIZE)

        const timelineTotalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
        const timelineStartIdx = (timelinePage - 1) * PAGE_SIZE
        const timelineChapters = sorted.slice(timelineStartIdx, timelineStartIdx + PAGE_SIZE)

        const toggleExpand = (chap) => {
          setExpandedChapterId((prev) => prev === chap.id ? null : chap.id)
        }

        return (
        <div>
          {chapters.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 className="card-section-title" style={{ margin: 0 }}>故事线</h3>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowTimeline(!showTimeline)}>
                  {showTimeline ? '收起' : '展开'}故事线
                </button>
              </div>
              {showTimeline && (
                <div className="timeline" style={{ marginBottom: 24 }}>
                  {timelineChapters.map((c) => (
                    <div
                      key={c.id}
                      className={`timeline-node ${c.content ? 'written' : ''}`}
                    >
                      <div className="timeline-node-header">
                        <span style={{ fontSize: 12, color: '#6B74A8', fontWeight: 700 }}>
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
                          约 {countWords(c.content)} 字
                        </div>
                      )}
                    </div>
                  ))}
                  {timelineTotalPages > 1 && (
                    <div className="pagination" style={{ marginTop: 12, marginBottom: 0 }}>
                      <button
                        className="pagination-btn"
                        disabled={timelinePage <= 1}
                        onClick={() => setTimelinePage((p) => Math.max(1, p - 1))}
                      >
                        ‹
                      </button>
                      {Array.from({ length: timelineTotalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          className={`pagination-btn ${p === timelinePage ? 'active' : ''}`}
                          onClick={() => setTimelinePage(p)}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        className="pagination-btn"
                        disabled={timelinePage >= timelineTotalPages}
                        onClick={() => setTimelinePage((p) => Math.min(timelineTotalPages, p + 1))}
                      >
                        ›
                      </button>
                      <input
                        type="number"
                        className="pagination-jump"
                        min={1}
                        max={timelineTotalPages}
                        placeholder="跳转"
                        ref={timelineJumpRef}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = parseInt(e.target.value)
                            if (v >= 1 && v <= timelineTotalPages) setTimelinePage(v)
                            e.target.value = ''
                          }
                        }}
                      />
                      <button
                        className="pagination-btn"
                        onClick={() => {
                          const input = timelineJumpRef.current
                          const v = parseInt(input?.value)
                          if (v >= 1 && v <= timelineTotalPages) setTimelinePage(v)
                          if (input) input.value = ''
                        }}
                      >
                        跳
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 className="card-section-title" style={{ margin: 0 }}>章节管理</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowChapForm(!showChapForm)}>
                + 添加章节
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/outline`)}>
                AI 规划
              </button>
            </div>
          </div>

          {showChapForm && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="form-group">
                <label className="form-label">章节序号</label>
                <input className="form-input" type="number" value={chapForm.number} onChange={(e) => setChapForm({ ...chapForm, number: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="form-group">
                <label className="form-label">章节标题</label>
                <input className="form-input" value={chapForm.title} onChange={(e) => setChapForm({ ...chapForm, title: e.target.value })} placeholder="输入章节标题" />
              </div>
              <div className="form-group">
                <label className="form-label">章节概要（建议 40 字以上，说明核心事件、出场人物、剧情推进）</label>
                <textarea className="form-input" rows={4} value={chapForm.summary} onChange={(e) => setChapForm({ ...chapForm, summary: e.target.value })} placeholder="例：主角林风在玄天城遇到神秘少女苏雪，两人因争夺拍卖行的一柄古剑结缘。苏雪身中寒毒，林风以剑谱中的秘法相救，却引来暗影楼的追杀..." />
              </div>
              <div className="btn-group" style={{ margin: 0 }}>
                <button className="btn btn-primary btn-sm" onClick={handleAddChapter} disabled={!chapForm.title.trim()}>保存章节</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowChapForm(false)}>取消</button>
              </div>
            </div>
          )}

          {chapters.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <p>还没有章节，去章节策划对话中让 AI 帮你规划吧</p>
            </div>
          ) : (
            <div>
              {pageChapters.map((c) => (
                <div key={c.id} className="outline-chapter-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <ChapterItem
                        chapter={c}
                        onWrite={() => navigate(`/project/${id}/write`)}
                        onClick={toggleExpand}
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
                  {/* Inline expanded content */}
                  {expandedChapterId === c.id && c.content && (
                    <div className="outline-chapter-expanded">
                      <div className="outline-chapter-expanded-header">
                        <span className="outline-chapter-expanded-title">
                          第{c.number}章 {c.title || '未命名'}
                        </span>
                        <span style={{ fontSize: 12, color: '#9A9A9A' }}>
                          约 {countWords(c.content)} 字
                        </span>
                      </div>
                      {c.summary && (
                        <div className="outline-chapter-expanded-summary">
                          <span style={{ fontWeight: 600, fontSize: 11, color: '#6B74A8' }}>概要：</span>
                          {c.summary}
                        </div>
                      )}
                      {c.content}
                    </div>
                  )}
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="pagination-btn"
                    disabled={outlinePage <= 1}
                    onClick={() => setOutlinePage((p) => Math.max(1, p - 1))}
                  >
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      className={`pagination-btn ${p === outlinePage ? 'active' : ''}`}
                      onClick={() => setOutlinePage(p)}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    className="pagination-btn"
                    disabled={outlinePage >= totalPages}
                    onClick={() => setOutlinePage((p) => Math.min(totalPages, p + 1))}
                  >
                    ›
                  </button>
                  <input
                    type="number"
                    className="pagination-jump"
                    min={1}
                    max={totalPages}
                    placeholder="跳转"
                    ref={outlineJumpRef}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = parseInt(e.target.value)
                        if (v >= 1 && v <= totalPages) setOutlinePage(v)
                        e.target.value = ''
                      }
                    }}
                  />
                  <button
                    className="pagination-btn"
                    onClick={() => {
                      const input = outlineJumpRef.current
                      const v = parseInt(input?.value)
                      if (v >= 1 && v <= totalPages) setOutlinePage(v)
                      if (input) input.value = ''
                    }}
                  >
                    跳
                  </button>
                  <span className="pagination-info">
                    共 {sorted.length} 章，{totalPages} 页
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        )
      })()}

      {/* Revision Tab */}
      {tab === 'revision' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 className="card-section-title" style={{ margin: 0 }}>已完成章节</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/revision`)}>
              AI 修订讨论
            </button>
          </div>

          {chapters.filter((c) => c.content).length === 0 ? (
            <div className="empty-state">
              <p>还没有已完成的章节内容</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate(`/project/${id}/write`)}>
                去写作
              </button>
            </div>
          ) : (
            <div>
              {chapters
                .filter((c) => c.content)
                .sort((a, b) => a.number - b.number)
                .map((c) => (
                  <div key={c.id} className="revision-chapter-card">
                    <div className="revision-chapter-header">
                      <span className="revision-chapter-num">第{c.number}章</span>
                      <span className="revision-chapter-title">{c.title || '未命名'}</span>
                      <span className="revision-word-count">约 {countWords(c.content)} 字</span>
                    </div>
                    {c.summary && (
                      <div className="revision-chapter-summary">{c.summary}</div>
                    )}
                    <div className="revision-chapter-preview">
                      {c.content.slice(0, 200)}
                      {c.content.length > 200 ? '...' : ''}
                    </div>
                    <div className="btn-group" style={{ margin: '8px 0 0' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => navigate(`/project/${id}/write`)}>
                        继续编辑
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/read`)}>
                        阅读模式
                      </button>
                    </div>
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
            <h3 className="card-section-title" style={{ margin: 0 }}>人物列表</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCharForm(!showCharForm)}>
                + 添加人物
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/project/${id}/characters`)}>
                AI 设计
              </button>
            </div>
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

    </div>
  )
}
