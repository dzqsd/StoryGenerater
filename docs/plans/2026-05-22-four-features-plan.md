# 四大功能增强实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为小说工坊新增暗色模式、写作统计仪表盘、角色关系图谱、版本历史四大功能。

**Architecture:** 全部纯前端实现，无新依赖。CSS 变量驱动暗色模式，Canvas 手绘关系图谱，IndexedDB 存储快照和关系数据，自写简易力布局和 diff 算法。

**Tech Stack:** React 18, Dexie.js, Canvas API, CSS Custom Properties

---

### Task 1: 数据库升级 — 新增 version_snapshots 和 character_relations 表

**Files:**
- Modify: `src/db/index.js`

**Step 1: 升级数据库 schema**

修改 `src/db/index.js`，升级版本号并新增两张表：

```js
// version 4 → version 5
db.version(5).stores({
  projects: '++id, title, status, createdAt',
  characters: '++id, projectId, name',
  chapters: '++id, projectId, number, status',
  conversations: '++id, projectId, mode',
  settings: 'key',
  chapter_summaries: '++id, chapterId',
  plot_arcs: '++id, projectId, type, status',
  version_snapshots: '++id, chapterId, createdAt',
  character_relations: '++id, projectId, fromCharId, toCharId',
})
```

**Step 2: 新增 version_snapshots CRUD**

在 `src/db/index.js` 末尾添加以下函数：

```js
// ====== Version Snapshots ======

export async function createSnapshot(chapterId, content) {
  const wordCount = countWords(content)
  return await db.version_snapshots.add({
    chapterId: Number(chapterId),
    content,
    wordCount,
    createdAt: Date.now(),
  })
}

export async function getSnapshotsByChapter(chapterId) {
  return await db.version_snapshots
    .where({ chapterId: Number(chapterId) })
    .reverse()
    .sortBy('createdAt')
}

export async function getSnapshot(id) {
  return await db.version_snapshots.get(Number(id))
}

export async function deleteSnapshot(id) {
  await db.version_snapshots.delete(Number(id))
}

export async function cleanupSnapshots(chapterId, maxCount = 20, maxAgeDays = 7) {
  const all = await db.version_snapshots
    .where({ chapterId: Number(chapterId) })
    .sortBy('createdAt')
  const cutoff = Date.now() - maxAgeDays * 86400000
  const oldIds = all.filter((s) => s.createdAt < cutoff).map((s) => s.id)
  const excessIds = all.length - maxCount > 0
    ? all.slice(0, all.length - maxCount).map((s) => s.id)
    : []
  const toDelete = [...new Set([...oldIds, ...excessIds])]
  for (const id of toDelete) {
    await db.version_snapshots.delete(id)
  }
}

export async function getDailyWritingDates(projectId) {
  const chapters = await db.chapters
    .where({ projectId: Number(projectId) })
    .toArray()
  const chapterIds = chapters.map((c) => c.id)
  const allSnapshots = []
  for (const cid of chapterIds) {
    const snaps = await db.version_snapshots
      .where({ chapterId: cid })
      .toArray()
    allSnapshots.push(...snaps)
  }
  const days = new Set()
  for (const s of allSnapshots) {
    const d = new Date(s.createdAt)
    days.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)
  }
  return Array.from(days).sort().reverse()
}
```

注意：需要在文件顶部从 `../utils/wordCount` import `countWords`，或直接在函数内用字符长度估算。选择 import：

```js
import { countWords } from '../utils/wordCount'
```

**Step 3: 新增 character_relations CRUD**

在 `src/db/index.js` 末尾添加：

```js
// ====== Character Relations ======

export async function saveCharacterRelation(relation) {
  const existing = await db.character_relations
    .where({
      projectId: Number(relation.projectId),
      fromCharId: Number(relation.fromCharId),
      toCharId: Number(relation.toCharId),
      type: relation.type,
    })
    .first()
  if (existing) return existing.id
  if (relation.id) {
    await db.character_relations.update(relation.id, relation)
    return relation.id
  }
  return await db.character_relations.add(relation)
}

export async function getCharacterRelations(projectId) {
  return await db.character_relations
    .where({ projectId: Number(projectId) })
    .toArray()
}

export async function deleteCharacterRelation(id) {
  await db.character_relations.delete(Number(id))
}
```

**Step 4: 验证**

启动开发服务器，打开浏览器控制台，确认 IndexedDB 中 `StoryGenerater` 数据库版本升级到 v5，新表存在。

```bash
npm run dev
```

---

### Task 2: 暗色模式

**Files:**
- Create: `src/hooks/useDarkMode.js`
- Modify: `src/styles/global.css`
- Modify: `src/components/Layout.jsx`

**Step 1: 创建 useDarkMode hook**

创建 `src/hooks/useDarkMode.js`：

```js
import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'storygen-theme'

function getInitial() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'light'
  } catch {
    return 'light'
  }
}

export default function useDarkMode() {
  const [theme, setTheme] = useState(getInitial)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch { /* ignore */ }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'))
  }, [])

  const isDark = theme === 'dark'

  return { theme, isDark, toggle }
}
```

**Step 2: 重构 global.css — 抽取 CSS 变量**

在 `src/styles/global.css` 顶部 `* { }` 块之前插入 `:root` 变量定义：

```css
:root {
  --bg-body: #DEE8ED;
  --bg-sidebar: #D1DEE5;
  --bg-sidebar-hover: #C5D4DD;
  --bg-sidebar-active: #C5D4DD;
  --bg-card: #FFFFFF;
  --bg-card-alt: #F4F2EC;
  --bg-tools-group: rgba(252, 250, 244, 0.45);
  --bg-input: #FCFAF4;
  --bg-empty: #F7F5F0;
  --bg-toast: #333333;

  --text-body: #4A4A4A;
  --text-heading: #3A3A3A;
  --text-sidebar: #6B7A8D;
  --text-sidebar-active: #5A628F;
  --text-muted: #9A9A9A;
  --text-accent: #6B74A8;

  --border-light: #C5D4DD;
  --border-card: #E5DFD3;
  --border-input: #D1CEC5;
  --border-sidebar-active: #6B74A8;

  --accent: #6B74A8;
  --accent-hover: #5A628F;
  --accent-light: rgba(107, 116, 168, 0.08);

  --btn-primary-bg: #6B74A8;
  --btn-primary-hover: #5A628F;
  --btn-secondary-bg: #E5DFD3;
  --btn-secondary-hover: #D1CEC5;
  --btn-danger-bg: #D4A5A5;
  --btn-danger-hover: #C48888;

  --status-planned: #B0A090;
  --status-draft: #C4A44A;
  --status-done: #6BA87D;

  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.08);
  --shadow-lg: 0 4px 16px rgba(0,0,0,0.1);

  --font-sans: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-display: 'Archivo', sans-serif;
  --font-serif: 'Noto Serif SC', serif;
}
```

然后在文件中将所有硬编码颜色替换为对应的变量引用。核心替换模式：

| 原值 | 替换为 |
|------|--------|
| `#DEE8ED` | `var(--bg-body)` |
| `#D1DEE5` | `var(--bg-sidebar)` |
| `#C5D4DD` | `var(--bg-sidebar-hover)` / `var(--border-light)` |
| `#FFFFFF` / `#fff` / `white` | `var(--bg-card)` |
| `#F4F2EC` | `var(--bg-card-alt)` |
| `rgba(252, 250, 244, 0.45)` | `var(--bg-tools-group)` |
| `#FCFAF4` | `var(--bg-input)` |
| `#F7F5F0` | `var(--bg-empty)` |
| `#4A4A4A` | `var(--text-body)` |
| `#3A3A3A` | `var(--text-heading)` |
| `#6B7A8D` | `var(--text-sidebar)` |
| `#5A628F` | `var(--text-sidebar-active)` / `var(--accent-hover)` |
| `#9A9A9A` | `var(--text-muted)` |
| `#6B74A8` | `var(--text-accent)` / `var(--accent)` / `var(--border-sidebar-active)` |
| `#E5DFD3` | `var(--border-card)` |
| `#D1CEC5` | `var(--border-input)` |
| `#D4A5A5` | `var(--btn-danger-bg)` |
| `#C48888` | `var(--btn-danger-hover)` |
| `#B0A090` | `var(--status-planned)` |
| `#C4A44A` | `var(--status-draft)` |
| `#6BA87D` | `var(--status-done)` |

> 注意：逐一替换，保留渐变色中的硬编码值暂不变量化（如 `linear-gradient(...)` 中的颜色）。rgba 形式的颜色需要在变量层面处理。

**Step 3: 新增暗色主题规则**

在 `:root` 块之后添加：

```css
[data-theme="dark"] {
  --bg-body: #1a1a2e;
  --bg-sidebar: #16213e;
  --bg-sidebar-hover: #1f2a4a;
  --bg-sidebar-active: #1f2a4a;
  --bg-card: #1f2940;
  --bg-card-alt: #252d45;
  --bg-tools-group: rgba(31, 41, 64, 0.6);
  --bg-input: #25304a;
  --bg-empty: #1e2540;
  --bg-toast: #2a3555;

  --text-body: #c8c8d0;
  --text-heading: #d8d8e0;
  --text-sidebar: #8899b0;
  --text-sidebar-active: #8B94C8;
  --text-muted: #6a7a90;
  --text-accent: #8B94C8;

  --border-light: #2a3555;
  --border-card: #2a3555;
  --border-input: #2a3a5a;
  --border-sidebar-active: #8B94C8;

  --accent: #8B94C8;
  --accent-hover: #9BA4D8;
  --accent-light: rgba(139, 148, 200, 0.12);

  --btn-primary-bg: #8B94C8;
  --btn-primary-hover: #9BA4D8;
  --btn-secondary-bg: #2a3555;
  --btn-secondary-hover: #354060;
  --btn-danger-bg: #8B5A5A;
  --btn-danger-hover: #A06A6A;

  --status-planned: #7a8090;
  --status-draft: #B8A060;
  --status-done: #6BA87D;

  --shadow-sm: 0 1px 3px rgba(0,0,0,0.2);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.3);
  --shadow-lg: 0 4px 16px rgba(0,0,0,0.4);
}
```

**Step 4: 在 Layout 添加切换按钮**

修改 `src/components/Layout.jsx`：

```jsx
import { NavLink, useLocation } from 'react-router-dom'
import useDarkMode from '../hooks/useDarkMode'

// ... 现有 nav 配置不变 ...

export default function Layout({ children }) {
  const location = useLocation()
  const inProject = location.pathname.startsWith('/project/')
  const id = inProject ? location.pathname.split('/')[2] : null
  const { isDark, toggle } = useDarkMode()

  return (
    <div className="app-layout">
      <aside className="sidebar">
        {/* ... 现有 sidebar 内容不变 ... */}
        <div className="sidebar-divider" />
        <button className="theme-toggle" onClick={toggle} title={isDark ? '切换亮色模式' : '切换暗色模式'}>
          {isDark ? '☀' : '☾'}
        </button>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  )
}
```

在 `src/styles/global.css` 末尾添加 `.theme-toggle` 样式：

```css
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 8px auto;
  border-radius: 50%;
  background: var(--bg-card-alt);
  color: var(--text-sidebar);
  font-size: 18px;
  transition: all 0.2s ease;
  border: 1px solid var(--border-light);
}
.theme-toggle:hover {
  color: var(--text-accent);
  border-color: var(--accent);
}
```

**Step 5: 验证**

```bash
npm run dev
```

- 点击侧边栏底部日/月按钮，主题应切换
- 刷新页面，主题应保持
- 检查所有页面在暗色模式下可读

---

### Task 3: 写作统计仪表盘

**Files:**
- Modify: `src/pages/ProjectDashboard.jsx`

**Step 1: 添加统计计算逻辑**

在 `ProjectDashboard.jsx` 的 `load` 函数附近添加一个 `computeStats` 函数：

```js
async function computeStats() {
  const chapters = await getChaptersByProject(id)
  const plotArcs = await getPlotArcsByProject(id)
  const allSnapshots = []
  for (const ch of chapters) {
    const snaps = await getSnapshotsByChapter(ch.id)
    allSnapshots.push(...snaps)
  }

  const totalWords = chapters
    .filter((c) => c.content)
    .reduce((sum, c) => sum + countWords(c.content), 0)

  const doneChapters = chapters.filter((c) => c.status === 'done').length
  const totalChapters = chapters.length
  const progress = totalChapters > 0 ? Math.round((doneChapters / totalChapters) * 100) : 0

  // 今日新增字数
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartTs = todayStart.getTime()
  const todaySnaps = allSnapshots.filter((s) => s.createdAt >= todayStartTs)
  const todayWords = todaySnaps.length > 0
    ? todaySnaps[todaySnaps.length - 1].wordCount - todaySnaps[0].wordCount
    : 0

  // 连续写作天数
  const dates = await getDailyWritingDates(id)
  let streak = 0
  const today = new Date()
  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(today)
    expected.setDate(today.getDate() - i)
    const expectedStr = `${expected.getFullYear()}-${expected.getMonth() + 1}-${expected.getDate()}`
    if (dates[i] === expectedStr) {
      streak++
    } else {
      break
    }
  }

  // 伏笔追踪
  const openArcs = plotArcs.filter((a) => a.status === 'open').length
  const resolvedArcs = plotArcs.filter((a) => a.status === 'resolved').length
  const totalArcs = plotArcs.length

  return { totalWords, doneChapters, totalChapters, progress, todayWords: Math.max(0, todayWords), streak, openArcs, resolvedArcs, totalArcs }
}
```

注意需要在文件顶部新增 import：
```js
import { getSnapshotsByChapter, getDailyWritingDates } from '../db'
import { countWords } from '../utils/wordCount'
```

**Step 2: 在总览 tab 添加统计卡片**

在现有 4 张 `dash-stat-card` 行之后、overview tab 结束之前，插入统计卡片区域：

```jsx
{stats && (
  <div className="card" style={{ marginTop: 20 }}>
    <h3 className="card-section-title">写作统计</h3>
    <div className="dash-stats-row">
      <div className="dash-stat-card">
        <div className="dash-stat-num">{stats.totalWords.toLocaleString()}</div>
        <div className="dash-stat-label">总字数</div>
      </div>
      <div className="dash-stat-card">
        <div className="dash-stat-num">{stats.doneChapters}</div>
        <div className="dash-stat-label">已完成章节</div>
      </div>
      <div className="dash-stat-card">
        <div className="dash-stat-num">{stats.todayWords > 0 ? '+' + stats.todayWords.toLocaleString() : '—'}</div>
        <div className="dash-stat-label">今日新增字数</div>
      </div>
      <div className="dash-stat-card">
        <div className="dash-stat-num">{stats.streak || '—'}</div>
        <div className="dash-stat-label">连续写作天数</div>
      </div>
      <div className="dash-stat-card">
        <div className="dash-stat-num">{stats.progress}%</div>
        <div className="dash-stat-label">创作进度</div>
        <div className="progress-bar" style={{ marginTop: 6 }}>
          <div className="progress-bar-fill" style={{ width: stats.progress + '%' }} />
        </div>
      </div>
      <div className="dash-stat-card">
        <div className="dash-stat-num">{stats.totalArcs > 0 ? `${stats.resolvedArcs}/${stats.totalArcs}` : '—'}</div>
        <div className="dash-stat-label">伏笔追踪</div>
      </div>
    </div>
  </div>
)}
```

在组件 state 中添加 `stats`，在 `load` 函数中计算：

```js
const [stats, setStats] = useState(null)

const load = async () => {
  // ... 现有加载逻辑 ...
  const st = await computeStats()
  setStats(st)
}
```

注意：`computeStats` 需要在 `load` 内部或作为独立函数被 `load` 调用，且 `id` 需要可用。

**Step 3: 添加进度条样式**

在 `global.css` 末尾添加：

```css
.progress-bar {
  width: 100%;
  height: 4px;
  background: var(--bg-card-alt);
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}
```

**Step 4: 验证**

```bash
npm run dev
```

- 进入任意项目总览页，确认统计卡片正确显示
- 无数据时显示 "—" 而非报错
- 有章节和快照数据后，确认数值正确

---

### Task 4: 版本历史/定时快照

**Files:**
- Modify: `src/pages/WritePage.jsx`

**Step 1: 添加快照逻辑到 WritePage**

在 `WritePage.jsx` 中新增 state 和相关逻辑：

```js
// 新增 import
import { createSnapshot, getSnapshotsByChapter, getSnapshot, deleteSnapshot, cleanupSnapshots } from '../db'

// 新增 state
const [showHistory, setShowHistory] = useState(false)
const [snapshots, setSnapshots] = useState([])
const [diffTarget, setDiffTarget] = useState(null)
const [diffContent, setDiffContent] = useState('')
const lastSnapshotRef = useRef(null)
const snapshotTimerRef = useRef(null)
```

**Step 2: 定时快照逻辑**

在 `useEffect` 中设置定时器（与现有数据加载 effect 并列）：

```js
// 定时自动快照（每5分钟）
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
```

**Step 3: 手动保存时同时创建快照**

修改 `handleSave` 函数，在 `updateChapterContent` 之后添加：

```js
// 保存时创建快照
if (content) {
  await createSnapshot(selected.id, content)
  lastSnapshotRef.current = content
  await cleanupSnapshots(selected.id)
}
```

并在 `runPipeline` 完成时（pipeline stage 变为 done）重置快照引用：

```js
// 在 pipeline result 处理完成后
lastSnapshotRef.current = result.final
```

**Step 4: 历史版本面板 UI**

在编辑器工具栏区域（`write-toolbar` 附近）添加历史版本按钮：

```jsx
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
```

在编辑器区域右侧（或作为覆盖面板）添加历史版本列表：

```jsx
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
```

**Step 5: 简易 diff 函数**

在 WritePage.jsx 文件顶部（组件外）添加：

```js
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
```

**Step 6: 历史面板样式**

在 `global.css` 末尾添加：

```css
.history-panel {
  position: fixed;
  right: 0;
  top: 56px;
  bottom: 0;
  width: 360px;
  background: var(--bg-card);
  border-left: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  z-index: 100;
  box-shadow: var(--shadow-lg);
}
.history-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-light);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-heading);
}
.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.history-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.history-item:hover {
  background: var(--bg-card-alt);
}
.history-item.active {
  border-color: var(--accent);
  background: var(--accent-light);
}
.history-item-time {
  font-size: 12px;
  color: var(--text-muted);
}
.history-item-words {
  font-size: 11px;
  color: var(--text-sidebar);
  margin-top: 2px;
}
.history-item-preview {
  font-size: 12px;
  color: var(--text-body);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-diff {
  border-top: 1px solid var(--border-light);
  padding: 12px;
  max-height: 40%;
  overflow-y: auto;
}
.history-diff-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
}
.history-diff-content {
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
  font-family: 'PingFang SC', 'Microsoft YaHei', monospace;
  background: var(--bg-card-alt);
  padding: 10px;
  border-radius: 6px;
}
```

**Step 7: 验证**

```bash
npm run dev
```

- 进入写作页，编辑内容，等 5 分钟确认自动快照生成
- 点击「保存草稿」确认快照生成
- 点击「历史版本」查看快照列表
- 点击某快照查看 diff
- 点击「恢复此版本」确认内容被替换

---

### Task 5: 角色关系图谱 — 力布局工具

**Files:**
- Create: `src/utils/forceLayout.js`

**Step 1: 实现力导向布局**

创建 `src/utils/forceLayout.js`：

```js
/**
 * Simple force-directed layout for character relation graph.
 * Nodes repel each other; edges pull connected nodes together.
 */

export function computeForceLayout(nodes, edges, options = {}) {
  const {
    width = 600,
    height = 400,
    iterations = 100,
    repulsion = 5000,
    attraction = 0.01,
    damping = 0.9,
  } = options

  // Initialize positions randomly if not set
  for (const node of nodes) {
    if (node.x == null) node.x = width / 2 + (Math.random() - 0.5) * 200
    if (node.y == null) node.y = height / 2 + (Math.random() - 0.5) * 200
    node.vx = 0
    node.vy = 0
  }

  // Build adjacency lookup
  const edgeMap = new Map()
  for (const node of nodes) {
    edgeMap.set(node.id, [])
  }
  for (const edge of edges) {
    const fromList = edgeMap.get(edge.from) || []
    fromList.push({ other: edge.to, type: edge.type })
    edgeMap.set(edge.from, fromList)
    const toList = edgeMap.get(edge.to) || []
    toList.push({ other: edge.from, type: edge.type })
    edgeMap.set(edge.to, toList)
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const force = repulsion / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    // Attraction along edges
    for (const node of nodes) {
      const neighbors = edgeMap.get(node.id) || []
      for (const { other } of neighbors) {
        const otherNode = nodes.find((n) => n.id === other)
        if (!otherNode) continue
        let dx = otherNode.x - node.x
        let dy = otherNode.y - node.y
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const force = dist * attraction
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        node.vx += fx
        node.vy += fy
      }
    }

    // Apply velocity with damping
    for (const node of nodes) {
      node.vx *= damping
      node.vy *= damping
      node.x += node.vx
      node.y += node.vy
    }
  }

  // Center the graph
  let cx = 0, cy = 0
  for (const node of nodes) {
    cx += node.x
    cy += node.y
  }
  cx /= nodes.length
  cy /= nodes.length
  const offsetX = width / 2 - cx
  const offsetY = height / 2 - cy
  for (const node of nodes) {
    node.x += offsetX
    node.y += offsetY
  }

  return { nodes, edges }
}
```

---

### Task 6: 角色关系图谱 — RelationGraph 组件

**Files:**
- Create: `src/components/RelationGraph.jsx`

**Step 1: 创建 Canvas 图谱组件**

创建 `src/components/RelationGraph.jsx`：

```jsx
import { useRef, useEffect, useState, useCallback } from 'react'
import { computeForceLayout } from '../utils/forceLayout'

const RELATION_COLORS = {
  '师徒': '#6B74A8',
  '敌对': '#C48888',
  '爱慕': '#D4A5A5',
  '亲子': '#8BA87D',
  '朋友': '#A8B86B',
  '盟友': '#6BA8A0',
  '上下级': '#B0A090',
  '其他': '#9A9A9A',
}

const NODE_RADIUS = 30

export default function RelationGraph({ characters, relations, width = 600, height = 400 }) {
  const canvasRef = useRef(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  // Build graph data
  useEffect(() => {
    const newNodes = characters.map((c) => ({
      id: c.id,
      label: c.name,
      role: c.role,
    }))
    const newEdges = relations.map((r) => ({
      from: r.fromCharId,
      to: r.toCharId,
      type: r.type,
      description: r.description,
    }))
    computeForceLayout(newNodes, newEdges, { width, height })
    setNodes(newNodes)
    setEdges(newEdges)
  }, [characters, relations, width, height])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    // Draw edges
    for (const edge of edges) {
      const fromNode = nodes.find((n) => n.id === edge.from)
      const toNode = nodes.find((n) => n.id === edge.to)
      if (!fromNode || !toNode) continue

      const highlight = hoveredNode && (hoveredNode.id === edge.from || hoveredNode.id === edge.to)
      ctx.strokeStyle = highlight ? RELATION_COLORS[edge.type] || '#9A9A9A' : 'rgba(154,154,154,0.3)'
      ctx.lineWidth = highlight ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(fromNode.x, fromNode.y)
      ctx.lineTo(toNode.x, toNode.y)
      ctx.stroke()

      // Arrow
      const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x)
      const arrowX = toNode.x - Math.cos(angle) * NODE_RADIUS
      const arrowY = toNode.y - Math.sin(angle) * NODE_RADIUS
      const arrowLen = 8
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath()
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(
        arrowX - arrowLen * Math.cos(angle - 0.5),
        arrowY - arrowLen * Math.sin(angle - 0.5)
      )
      ctx.lineTo(
        arrowX - arrowLen * Math.cos(angle + 0.5),
        arrowY - arrowLen * Math.sin(angle + 0.5)
      )
      ctx.closePath()
      ctx.fill()

      // Edge label at midpoint
      const mx = (fromNode.x + toNode.x) / 2
      const my = (fromNode.y + toNode.y) / 2
      ctx.fillStyle = '#9A9A9A'
      ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(edge.type, mx, my - 6)
    }

    // Draw nodes
    for (const node of nodes) {
      const isHovered = hoveredNode?.id === node.id
      ctx.fillStyle = isHovered ? '#6B74A8' : '#D1DEE5'
      ctx.strokeStyle = isHovered ? '#5A628F' : '#C5D4DD'
      ctx.lineWidth = isHovered ? 2.5 : 1.5
      ctx.beginPath()
      ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Label
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#4A4A4A'
      ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.label, node.x, node.y)
    }

    ctx.restore()
  }, [nodes, edges, hoveredNode, scale, offset, width, height])

  // Mouse handlers
  const getMousePos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - offset.x) / scale,
      y: (e.clientY - rect.top - offset.y) / scale,
    }
  }, [scale, offset])

  const handleMouseDown = useCallback((e) => {
    const pos = getMousePos(e)
    const hit = nodes.find((n) => {
      const dx = n.x - pos.x
      const dy = n.y - pos.y
      return Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS + 4
    })
    if (hit) {
      setDragging({ node: hit, startX: pos.x - hit.x, startY: pos.y - hit.y })
    }
  }, [nodes, getMousePos])

  const handleMouseMove = useCallback((e) => {
    const pos = getMousePos(e)
    if (dragging) {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragging.node.id
            ? { ...n, x: pos.x - dragging.startX, y: pos.y - dragging.startY }
            : n
        )
      )
      return
    }
    const hit = nodes.find((n) => {
      const dx = n.x - pos.x
      const dy = n.y - pos.y
      return Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS + 4
    })
    setHoveredNode(hit || null)
  }, [nodes, dragging, getMousePos])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setScale((s) => Math.min(3, Math.max(0.3, s * delta)))
  }, [])

  return (
    <div className="relation-graph-container">
      <canvas
        ref={canvasRef}
        style={{ width, height, cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {hoveredNode && (
        <div className="relation-graph-tooltip">
          {hoveredNode.label}（{hoveredNode.role}）
        </div>
      )}
    </div>
  )
}
```

---

### Task 7: 角色关系图谱 — 集成到项目仪表盘

**Files:**
- Modify: `src/pages/ProjectDashboard.jsx`

**Step 1: 在人物 tab 添加图谱和关系表单**

在人物 tab（`characters`）的角色列表下方添加：

```jsx
{/* 角色关系图谱 */}
{characters.length > 0 && (
  <div className="card" style={{ marginTop: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h3 className="card-section-title">角色关系图谱</h3>
      <button className="btn btn-primary btn-sm" onClick={() => setShowRelationForm(!showRelationForm)}>
        + 添加关系
      </button>
    </div>

    {showRelationForm && (
      <div style={{ marginBottom: 12, padding: '12px 14px', background: 'var(--bg-card-alt)', borderRadius: 8 }}>
        <div className="form-group">
          <label className="form-label">角色 A</label>
          <select className="form-select" value={relationForm.fromCharId} onChange={(e) => setRelationForm({ ...relationForm, fromCharId: Number(e.target.value) })}>
            <option value={0} disabled>选择角色</option>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">关系</label>
          <select className="form-select" value={relationForm.type} onChange={(e) => setRelationForm({ ...relationForm, type: e.target.value })}>
            {['师徒','敌对','爱慕','亲子','朋友','盟友','上下级','其他'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">角色 B</label>
          <select className="form-select" value={relationForm.toCharId} onChange={(e) => setRelationForm({ ...relationForm, toCharId: Number(e.target.value) })}>
            <option value={0} disabled>选择角色</option>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">描述（可选）</label>
          <input className="form-input" value={relationForm.description} onChange={(e) => setRelationForm({ ...relationForm, description: e.target.value })} placeholder="简述关系背景" />
        </div>
        <div className="btn-group" style={{ margin: 0 }}>
          <button className="btn btn-primary btn-sm" onClick={handleAddRelation} disabled={!relationForm.fromCharId || !relationForm.toCharId || relationForm.fromCharId === relationForm.toCharId}>添加</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowRelationForm(false)}>取消</button>
        </div>
      </div>
    )}

    {characterRelations.length > 0 ? (
      <RelationGraph
        characters={characters}
        relations={characterRelations}
        width={Math.min(600, window.innerWidth - 280)}
        height={400}
      />
    ) : (
      <div className="empty-state" style={{ padding: 20 }}>
        <p style={{ fontSize: 13 }}>还没有角色关系，手动添加或通过 AI 对话自动生成</p>
      </div>
    )}
  </div>
)}
```

**Step 2: 新增 state 和处理函数**

```js
// 新增 import
import RelationGraph from '../components/RelationGraph'
import { saveCharacterRelation, getCharacterRelations, deleteCharacterRelation } from '../db'

// 新增 state
const [characterRelations, setCharacterRelations] = useState([])
const [showRelationForm, setShowRelationForm] = useState(false)
const [relationForm, setRelationForm] = useState({ fromCharId: 0, toCharId: 0, type: '师徒', description: '' })

// 新增处理函数
const handleAddRelation = async () => {
  await saveCharacterRelation({ projectId: Number(id), ...relationForm })
  setRelationForm({ fromCharId: 0, toCharId: 0, type: '师徒', description: '' })
  setShowRelationForm(false)
  load()
}

// 在 load 函数中添加
const rels = await getCharacterRelations(id)
setCharacterRelations(rels)
```

---

### Task 8: 角色关系自动提取 — chatModes 增强

**Files:**
- Modify: `src/utils/chatModes.js`
- Modify: `src/pages/ChatPage.jsx`

**Step 1: 在 chatModes 中添加关系提取提示**

修改 `characters` 和 `general` 模式的 systemPrompt，在职责描述中增加关系提取说明。

在 `characters` 模式的 systemPrompt 中，`[CHARACTER]` 标签说明后添加：

```
- 角色关系确认后，用 [RELATION]...[/RELATION] 标签标注
  格式示例：
  [RELATION]
  角色A：林风
  角色B：苏雪
  关系：爱慕
  描述：两人在玄天城相遇后互生好感
  [/RELATION]
```

同样在 `general` 模式的标签说明中添加 `[RELATION]`。

**Step 2: 在 ChatPage 中添加关系提取函数**

在 `src/pages/ChatPage.jsx` 中添加（放在 `extractChapters` 函数后）：

```js
function extractRelations(content, existingCharacters) {
  const re = /\[RELATION\]([\s\S]*?)\[\/RELATION\]/g
  const results = []
  let match
  while ((match = re.exec(content)) !== null) {
    const block = match[1].trim()
    const charA = (block.match(/角色A[：:]\s*(.+)/) || [])[1]?.trim()
    const charB = (block.match(/角色B[：:]\s*(.+)/) || [])[1]?.trim()
    const type = (block.match(/关系[：:]\s*(.+)/) || [])[1]?.trim()
    const description = (block.match(/描述[：:]\s*(.+)/) || [])[1]?.trim()
    if (charA && charB && type) {
      const fromChar = existingCharacters.find((c) => c.name === charA)
      const toChar = existingCharacters.find((c) => c.name === charB)
      if (fromChar && toChar) {
        results.push({ fromCharId: fromChar.id, toCharId: toChar.id, type, description: description || '' })
      }
    }
  }
  return results
}
```

**Step 3: 在消息处理流程中调用关系提取**

在 ChatPage 中处理 AI 回复的逻辑处（搜索 `extractCharacters` 的调用位置），添加关系提取调用。在 AI 回复后、保存角色信息的同位置：

```js
// 提取角色关系
const relations = extractRelations(assistantContent, existingCharacters)
for (const rel of relations) {
  await saveCharacterRelation({ projectId: Number(id), ...rel })
}
if (relations.length > 0) {
  // 在 UI 中显示提取到的关系（追加到 assistant 消息）
  const relSummary = relations.map((r) => {
    const a = existingCharacters.find((c) => c.id === r.fromCharId)
    const b = existingCharacters.find((c) => c.id === r.toCharId)
    return `${a?.name || '?'} → ${r.type} → ${b?.name || '?'}`
  }).join('、')
  assistantContent += `\n\n[已提取角色关系：${relSummary}]`
}
```

---

### Task 9: 最终验证与收尾

**Step 1: 全量启动验证**

```bash
npm run dev
```

逐项验证：
1. **暗色模式**：切换按钮、刷新保持、所有页面可读
2. **统计卡片**：项目总览页底部 6 张卡片数值正确
3. **关系图谱**：人物 tab 可添加关系、Canvas 渲染图谱、可拖拽缩放
4. **版本历史**：写作页保存生成快照、历史面板查看 diff、恢复版本

**Step 2: 构建验证**

```bash
npm run build
```

确认生产构建无报错。

**Step 3: 提交**

```bash
git add .
git commit -m "feat: add dark mode, writing stats, relation graph & version history"
```
