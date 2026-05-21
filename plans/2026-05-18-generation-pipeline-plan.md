# 小说生成流水线改造 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 将 myGenerater 的章节生成从单次调用升级为四阶段流水线（详细大纲 → 草稿 → 审校 → 润色），并增加智能摘要链和伏笔追踪。

**Architecture:** 前端纯 React + Dexie，所有 LLM 调用通过 `src/api/deepseek.js` 的 `streamChat`。新增 `src/utils/summaryExtractor.js` 集中管理所有 prompt 构建。WritePage 改造为流水线状态机，ChatPage 和 ProjectDashboard 做数据补充。

**Tech Stack:** React 18, Vite 5, Dexie 3, DeepSeek API

---

### Task 1: 数据库迁移 — 新增两张表

**Files:**
- Modify: `src/db/index.js`

**Step 1: 更新 schema version**

在 `src/db/index.js` 中，将 `db.version(2).stores(...)` 改为 `db.version(3).stores(...)`，在原有 stores 基础上新增 `chapter_summaries` 和 `plot_arcs`：

```js
const db = new Dexie('StoryGenerater')

db.version(3).stores({
  projects: '++id, title, status, createdAt',
  characters: '++id, projectId, name',
  chapters: '++id, projectId, number, status',
  conversations: '++id, projectId, phase',
  settings: 'key',
  chapter_summaries: '++id, chapterId',
  plot_arcs: '++id, projectId, type, status',
})
```

**Step 2: 新增 CRUD 函数**

在文件末尾（`export default db` 之前）加入以下函数：

```js
// ====== Chapter Summaries ======

export async function saveChapterSummary(chapterId, summary) {
  const existing = await db.chapter_summaries.where({ chapterId: Number(chapterId) }).first()
  if (existing) {
    await db.chapter_summaries.update(existing.id, { summary, chapterId: Number(chapterId) })
    return existing.id
  }
  return await db.chapter_summaries.add({ chapterId: Number(chapterId), summary })
}

export async function getChapterSummary(chapterId) {
  return await db.chapter_summaries.where({ chapterId: Number(chapterId) }).first()
}

export async function getAllChapterSummaries(projectId) {
  // Join via chapters table — get all chapters of project, then their summaries
  const chapters = await db.chapters.where({ projectId: Number(projectId) }).sortBy('number')
  const result = []
  for (const ch of chapters) {
    const s = await db.chapter_summaries.where({ chapterId: ch.id }).first()
    result.push({ chapter: ch, summary: s?.summary || null })
  }
  return result
}

// ====== Plot Arcs ======

export async function savePlotArc(arc) {
  if (arc.id) {
    await db.plot_arcs.update(arc.id, arc)
    return arc.id
  }
  return await db.plot_arcs.add(arc)
}

export async function getPlotArcsByProject(projectId) {
  return await db.plot_arcs.where({ projectId: Number(projectId) }).toArray()
}

export async function getOpenPlotArcs(projectId) {
  return await db.plot_arcs
    .where({ projectId: Number(projectId), status: 'open' })
    .toArray()
}

export async function updatePlotArcStatus(id, status) {
  await db.plot_arcs.update(Number(id), { status })
}

export async function deletePlotArc(id) {
  await db.plot_arcs.delete(Number(id))
}
```

**Step 3: 验证**

```bash
cd F:/StoryGenerater/myGenerater && npx vite build 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add src/db/index.js
git commit -m "feat: add chapter_summaries and plot_arcs tables with CRUD"
```

---

### Task 2: 创建 Summary Extractor 工具模块

**Files:**
- Create: `src/utils/summaryExtractor.js`

**Step 1: 创建文件并实现所有 prompt 构建函数**

```js
// src/utils/summaryExtractor.js

/**
 * Build context string from all previous chapter summaries + current chapter info.
 * @param {Object} project - { title, genre, setting, synopsis }
 * @param {Array} characters - [{ name, role, traits, background }]
 * @param {Array} summaryChain - [{ chapter: { number, title, summary, content }, summary: {...} }]
 * @param {Object} targetChapter - { number, title, summary }
 */
export function buildContextBlock(project, characters, summaryChain, targetChapter) {
  const charBlock = characters.length > 0
    ? characters.map((c) => `- ${c.name}（${c.role}）：${c.traits || ''}；背景：${c.background || ''}`).join('\n')
    : '暂无'

  // Build structured summary chain for all previous chapters
  let summaryBlock = ''
  const prevChapters = summaryChain.filter((s) => s.chapter.number < targetChapter.number)
  if (prevChapters.length > 0) {
    summaryBlock = '====== 前文章节摘要链 ======\n'
    for (const { chapter, summary } of prevChapters) {
      if (summary) {
        summaryBlock += `第${chapter.number}章「${chapter.title}」：\n`
        summaryBlock += `  概要：${summary.summary || chapter.summary || '无'}\n`
        if (summary.characterChanges) summaryBlock += `  角色变化：${summary.characterChanges}\n`
        if (summary.keyScenes) summaryBlock += `  关键场景：${summary.keyScenes}\n`
        summaryBlock += '\n'
      } else {
        summaryBlock += `第${chapter.number}章「${chapter.title}」：${chapter.summary || '无摘要'}\n\n`
      }
    }
  }

  // Current chapter's previous chapter content (for continuity)
  const targetIdx = summaryChain.findIndex((s) => s.chapter.number === targetChapter.number)
  let previousContent = ''
  if (targetIdx > 0) {
    const prev = summaryChain[targetIdx - 1]
    if (prev.chapter.content) {
      previousContent = `\n====== 上一章完整内容（确保衔接） ======\n${prev.chapter.content}\n`
    }
  }

  return {
    charBlock,
    summaryBlock,
    previousContent,
  }
}

/**
 * Stage 1: Build detailed outline prompt
 */
export function buildDetailedOutlinePrompt(project, characters, summaryChain, targetChapter) {
  const { charBlock, summaryBlock, previousContent } = buildContextBlock(project, characters, summaryChain, targetChapter)
  const idx = summaryChain.findIndex((s) => s.chapter.number === targetChapter.number)
  const isFirst = idx === 0

  return `你是一位专业小说策划。根据以下信息，为指定章节撰写一份详细的写作大纲。

====== 作品设定 ======
- 标题：${project.title}
- 题材：${project.genre || '未定'}
- 世界观：${project.setting || '未定'}
- 主线概要：${project.synopsis || '未定'}

====== 人物列表 ======
${charBlock}
${summaryBlock}
${previousContent}

====== 当前章节信息 ======
第${targetChapter.number}章「${targetChapter.title || ''}」
章节概要：${targetChapter.summary || '无'}
${isFirst ? '这是第一章，请设计精彩的开篇。' : ''}

请撰写详细大纲，包含以下内容（纯文本，不用 markdown）：

1. 本章核心冲突/目标
2. 场景列表（每个场景标注地点、时间、出场人物）
3. 关键对话节点（1-2个）
4. 情感节奏（起伏）
5. 与前后章的衔接点

输出要求：300-500字，结构清晰。`
}

/**
 * Stage 2: Build draft prompt (refactored from original WritePage)
 */
export function buildDraftPrompt(project, characters, summaryChain, targetChapter, detailedOutline) {
  const { charBlock, summaryBlock, previousContent } = buildContextBlock(project, characters, summaryChain, targetChapter)
  const idx = summaryChain.findIndex((s) => s.chapter.number === targetChapter.number)
  const isFirst = idx === 0

  return `你是一位专业小说作家。根据详细大纲和设定，撰写指定章节的正文。

====== 作品设定 ======
- 标题：${project.title}
- 题材：${project.genre || '未定'}
- 世界观：${project.setting || '未定'}
- 主线概要：${project.synopsis || '未定'}

====== 人物列表（严格保持设定一致） ======
${charBlock}
${summaryBlock}
${previousContent}

====== 详细大纲 ======
${detailedOutline}

====== 写作要求 ======
撰写「第${targetChapter.number}章 ${targetChapter.title || ''}」
${isFirst ? '这是第一章，写出精彩开篇。' : `确保与上一章结尾无缝衔接。`}

具体要求：
1. 字数：至少1200字，目标1500字，不超过2000字。字数不足严重影响质量，请务必达标。
2. 展开描写：具体场景、对话、动作、心理描写，让读者身临其境。
3. 人物性格统一，文风一致。
4. 纯文本，不使用 markdown 格式。
5. 直接写正文，不加"第X章"标题。`
}

/**
 * Stage 3: Build consistency review prompt
 */
export function buildConsistencyReviewPrompt(project, characters, summaryChain, targetChapter, draftContent, plotArcs) {
  const { charBlock, summaryBlock } = buildContextBlock(project, characters, summaryChain, targetChapter)

  const arcsBlock = plotArcs.length > 0
    ? plotArcs.map((a) => `- [${a.type}] ${a.description}（状态：${a.status}）`).join('\n')
    : '暂无'

  return `你是一位严谨的小说审校编辑。请对照以下设定，检查本章草稿是否存在矛盾或不一致。

====== 小说设定 ======
- 标题：${project.title}
- 题材：${project.genre}
- 世界观：${project.setting}
- 主线概要：${project.synopsis}

====== 人物设定 ======
${charBlock}

====== 前文摘要链 ======
${summaryBlock}

====== 伏笔与未解决冲突 ======
${arcsBlock}

====== 本章草稿 ======
${draftContent}

检查要点：
1. 人物性格、能力是否与设定一致
2. 时间线是否连贯（不要出现同一天做了相隔万里的事）
3. 与前文摘要中的已发生事件是否有矛盾
4. 是否有未回收的伏笔或逻辑漏洞
5. 人物称呼是否一致

输出格式（纯文本）：
- 如发现矛盾，逐条列出，格式："[问题] ... [建议] ..."
- 如无明显问题，回复"审校通过，无明显问题。"`
}

/**
 * Stage 4: Build polish prompt
 */
export function buildPolishPrompt(draftContent, reviewResult) {
  return `你是一位专业小说润色编辑。根据审校意见，对草稿进行修改润色，输出最终版本。

====== 审校意见 ======
${reviewResult}

====== 当前草稿 ======
${draftContent}

修改要求：
1. 根据审校意见修复所有指出的问题
2. 提升文笔流畅度，修正语病
3. 保持原有字数（1200-2000字）
4. 纯文本，不使用 markdown
5. 直接输出最终正文，不加标题和说明
6. 如果审校意见为"通过"，则对本章进行文笔润色后输出`
}

/**
 * After save: extract structured chapter summary for future context
 */
export function buildChapterSummaryPrompt(project, chapter, chapterContent) {
  return `你是一位小说分析助手。刚完成了以下章节的写作，请提取结构化摘要。

====== 章节信息 ======
小说：${project.title}
第${chapter.number}章「${chapter.title || ''}」
正文：
${chapterContent}

请提取以下信息，用 JSON 格式返回（必须是严格的 JSON，不要加任何解释文字）：

{
  "summary": "本章事件概述（3-5句话，说清楚发生了什么）",
  "characterChanges": "角色状态变化（谁有新能力、关系变化、死亡/离开等，如无变化写'无'）",
  "foreshadowing": "本章新埋下的伏笔（如有，写具体内容；如无写'无'）",
  "keyScenes": "本章关键场景（地点+事件，2-3个）"
}`
}

/**
 * Parse JSON from LLM response (may have markdown code block wrapping)
 */
export function parseChapterSummaryJSON(raw) {
  try {
    // Try direct parse first
    return JSON.parse(raw)
  } catch {
    // Try extract from markdown code block
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try {
        return JSON.parse(match[1].trim())
      } catch {
        return null
      }
    }
    return null
  }
}
```

**Step 2: 验证**

```bash
cd F:/StoryGenerater/myGenerater && npx vite build 2>&1 | tail -5
```

Expected: Build succeeds, no import errors.

**Step 3: Commit**

```bash
git add src/utils/summaryExtractor.js
git commit -m "feat: add summary extractor with pipeline prompt builders"
```

---

### Task 3: WritePage 流水线改造

**Files:**
- Modify: `src/pages/WritePage.jsx`

这是核心改动。将当前的单次 `handleGenerate` 替换为四阶段流水线。

**Step 1: 新增 imports 和状态定义**

在现有 imports 后新增：

```js
import {
  buildDetailedOutlinePrompt,
  buildDraftPrompt,
  buildConsistencyReviewPrompt,
  buildPolishPrompt,
  buildChapterSummaryPrompt,
  parseChapterSummaryJSON,
} from '../utils/summaryExtractor'
import {
  saveChapterSummary,
  getAllChapterSummaries,
  getOpenPlotArcs,
  savePlotArc,
} from '../db'
```

在组件内现有状态声明后新增流水线状态：

```js
const [pipeline, setPipeline] = useState({
  stage: 'idle',        // 'idle' | 'outline' | 'draft' | 'review' | 'polish' | 'done'
  outline: '',
  draft: '',
  review: '',
  final: '',
})
const [abortFlag, setAbortFlag] = useState(false)
const pipelineRef = useRef({ abortFlag: false })
```

**Step 2: 改造 handleGenerate 为流水线**

删除现有 `handleGenerate` 函数，替换为：

```js
const runPipeline = async () => {
  if (!selected || pipeline.stage !== 'idle' && pipeline.stage !== 'done') return

  const key = await getSetting('apiKey')
  if (!key) {
    setError('请先在设置页面配置 API Key')
    return
  }

  setError('')
  setSavedMsg('')
  pipelineRef.current.abortFlag = false
  setAbortFlag(false)

  // Gather context
  const chars = await getCharactersByProject(id)
  const chaps = await getChaptersByProject(id)
  const summaryChain = await getAllChapterSummaries(id)
  // Merge chapters with their summaries
  const fullChain = chaps.map((c) => {
    const found = summaryChain.find((s) => s.chapter?.id === c.id || s.chapterId === c.id)
    return {
      chapter: c,
      summary: found?.summary || null,
    }
  })

  const proj = await getProject(id)
  const plotArcs = await getOpenPlotArcs(id)

  // --- Stage 1: Detailed Outline ---
  setPipeline((p) => ({ ...p, stage: 'outline', outline: '', draft: '', review: '', final: '' }))
  setContent('')

  if (pipelineRef.current.abortFlag) return

  const outlinePrompt = buildDetailedOutlinePrompt(proj, chars, fullChain, selected)
  const outlineMessages = [
    { role: 'system', content: '你是一位专业小说策划，用中文回复。' },
    { role: 'user', content: outlinePrompt },
  ]

  let outlineText = ''
  let aborted = false

  await streamChat(outlineMessages, {
    apiKey: key,
    temperature: 0.7,
    maxTokens: 1024,
    onChunk(chunk) {
      outlineText += chunk
      setPipeline((p) => ({ ...p, outline: outlineText }))
    },
    onDone() {},
    onError(err) {
      setError('大纲生成失败: ' + err)
      aborted = true
    },
  })

  if (aborted || pipelineRef.current.abortFlag) {
    setPipeline((p) => ({ ...p, stage: 'done' }))
    return
  }

  // Save outline to editor for display
  setContent(outlineText)

  // --- Stage 2: Draft ---
  setPipeline((p) => ({ ...p, stage: 'draft' }))

  const draftPrompt = buildDraftPrompt(proj, chars, fullChain, selected, outlineText)
  const draftMessages = [
    { role: 'system', content: '你是一位专业小说作家，用中文回复。' },
    { role: 'user', content: draftPrompt },
  ]

  let draftText = ''

  await streamChat(draftMessages, {
    apiKey: key,
    temperature: 0.85,
    maxTokens: 8192,
    onChunk(chunk) {
      draftText += chunk
      setPipeline((p) => ({ ...p, draft: draftText }))
      setContent(draftText)
    },
    onDone() {},
    onError(err) {
      setError('草稿生成失败: ' + err)
      aborted = true
    },
  })

  if (aborted || pipelineRef.current.abortFlag) {
    setPipeline((p) => ({ ...p, stage: 'done' }))
    return
  }

  // --- Stage 3: Consistency Review ---
  setPipeline((p) => ({ ...p, stage: 'review' }))

  const reviewPrompt = buildConsistencyReviewPrompt(proj, chars, fullChain, selected, draftText, plotArcs)
  const reviewMessages = [
    { role: 'system', content: '你是一位严谨的小说审校编辑，用中文回复。' },
    { role: 'user', content: reviewPrompt },
  ]

  let reviewText = ''

  await streamChat(reviewMessages, {
    apiKey: key,
    temperature: 0.3,
    maxTokens: 2048,
    onChunk(chunk) {
      reviewText += chunk
      setPipeline((p) => ({ ...p, review: reviewText }))
    },
    onDone() {},
    onError(err) {
      // Review failure is non-blocking, continue with empty review
      reviewText = '审校服务暂不可用，自动通过。'
      setPipeline((p) => ({ ...p, review: reviewText }))
    },
  })

  if (aborted || pipelineRef.current.abortFlag) {
    setPipeline((p) => ({ ...p, stage: 'done' }))
    return
  }

  // --- Stage 4: Polish ---
  setPipeline((p) => ({ ...p, stage: 'polish' }))

  const polishPrompt = buildPolishPrompt(draftText, reviewText)
  const polishMessages = [
    { role: 'system', content: '你是一位专业小说润色编辑，用中文回复。' },
    { role: 'user', content: polishPrompt },
  ]

  let finalText = ''

  await streamChat(polishMessages, {
    apiKey: key,
    temperature: 0.6,
    maxTokens: 8192,
    onChunk(chunk) {
      finalText += chunk
      setPipeline((p) => ({ ...p, final: finalText }))
      setContent(finalText)
    },
    onDone() {},
    onError(err) {
      // Polish failure falls back to draft
      finalText = draftText
      setPipeline((p) => ({ ...p, final: finalText }))
      setContent(finalText)
      setError('润色失败，已退回草稿版本')
    },
  })

  setPipeline((p) => ({ ...p, stage: 'done' }))
  editorRef.current?.focus()
}

const handleAbort = () => {
  pipelineRef.current.abortFlag = true
  setAbortFlag(true)
  setPipeline((p) => ({ ...p, stage: 'done' }))
}
```

**Step 3: 改造 handleSave — 保存后自动提取摘要**

在现有 `handleSave` 末尾（`setSaving(false)` 之后），增加摘要提取：

```js
// After save, extract structured summary (fire and forget)
handleSave = async () => {
  // ... existing save logic ...

  // Auto-extract summary after successful save
  if (content && selected) {
    try {
      const proj = await getProject(id)
      const summaryPrompt = buildChapterSummaryPrompt(proj, selected, content)
      const summaryMessages = [
        { role: 'system', content: '你是小说分析助手，始终返回严格 JSON，不要加额外文字。' },
        { role: 'user', content: summaryPrompt },
      ]
      // Use non-streaming call for summary extraction
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: summaryMessages,
          temperature: 0.3,
          max_tokens: 1024,
          stream: false,
        }),
      })
      const data = await resp.json()
      const raw = data.choices?.[0]?.message?.content || ''
      const parsed = parseChapterSummaryJSON(raw)
      if (parsed) {
        await saveChapterSummary(selected.id, parsed)

        // Auto-save foreshadowing to plot_arcs
        if (parsed.foreshadowing && parsed.foreshadowing !== '无') {
          await savePlotArc({
            projectId: Number(id),
            type: 'foreshadowing',
            description: `第${selected.number}章：${parsed.foreshadowing}`,
            status: 'open',
            relatedChapter: selected.number,
          })
        }
      }
    } catch {
      // Summary extraction failure is non-blocking
    }
  }
}
```

**Step 4: 替换 UI 中的生成按钮区域**

将现有生成按钮区域替换为流水线进度条 + 按钮：

```jsx
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

{/* Show intermediate results */}
{pipeline.stage === 'done' && pipeline.outline && (
  <details style={{ marginBottom: 8 }}>
    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888' }}>
      查看中间结果（大纲 / 草稿 / 审校）
    </summary>
    <div style={{ fontSize: 12, color: '#aaa', marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
      <p><strong>详细大纲：</strong></p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{pipeline.outline}</pre>
      <p><strong>审校意见：</strong></p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{pipeline.review}</pre>
    </div>
  </details>
)}
```

生成按钮简化为：

```jsx
<button
  className="btn btn-primary"
  onClick={runPipeline}
  disabled={pipeline.stage !== 'idle' && pipeline.stage !== 'done'}
>
  {(pipeline.stage !== 'idle' && pipeline.stage !== 'done') ? '生成中...' : '🚀 流水线生成'}
</button>
```

删除 `handleRegenerate` 函数和对应按钮（重新生成直接再点一次流水线即可）。

**Step 5: 添加 pipeline CSS**

在 `src/styles/global.css` 末尾添加：

```css
/* Pipeline bar */
.pipeline-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #16213e;
  border-radius: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.pipeline-step {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
}

.pipeline-step.active {
  color: #e94560;
}

.pipeline-step.done {
  color: #48c78e;
}

.pipeline-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  border: 2px solid currentColor;
  background: transparent;
}

.pipeline-step.active .pipeline-dot {
  background: #e94560;
  border-color: #e94560;
  color: #fff;
  animation: pulse 1.2s infinite;
}

.pipeline-step.done .pipeline-dot {
  background: #48c78e;
  border-color: #48c78e;
  color: #fff;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.pipeline-label {
  white-space: nowrap;
}
```

**Step 6: 验证**

```bash
cd F:/StoryGenerater/myGenerater && npx vite build 2>&1 | tail -10
```

Expected: Build succeeds.

修复可能的问题：
- 删除了 `handleRegenerate` 后，模板中对应的 `onClick={handleRegenerate}` 按钮也需要删除
- `buildWritingPrompt` 函数可以删除（已被 `buildDraftPrompt` 替代）

**Step 7: Commit**

```bash
git add src/pages/WritePage.jsx src/styles/global.css
git commit -m "feat: replace single-shot generation with 4-stage pipeline"
```

---

### Task 4: ChatPage 伏笔提取

**Files:**
- Modify: `src/pages/ChatPage.jsx`

**Step 1: 在 processAIResponse 中增加伏笔提取**

在 `processAIResponse` 函数末尾（`// 5. Extract genre` 之后），增加：

```js
// 6. Extract foreshadowing / plot arcs from synopsis content
const synopsisContent = extractSynopsis(content)
if (synopsisContent && synopsisContent.length > 50) {
  // Use simple keyword detection for potential conflicts/foreshadowing
  const arcPatterns = [
    { re: /复仇|报仇|灭门|血海深仇/, desc: '主线复仇线' },
    { re: /阴谋|暗中|秘密|身份.*揭|真相/, desc: '阴谋/真相线' },
    { re: /魔神|上古|封印|转世/, desc: '神话/魔神线' },
    { re: /叛徒|内鬼|出卖/, desc: '叛徒线' },
    { re: /凤凰|血脉|觉醒/, desc: '血脉觉醒线' },
  ]
  for (const { re, desc } of arcPatterns) {
    if (re.test(synopsisContent)) {
      const existing = await db.plot_arcs
        .where({ projectId: Number(id), description: desc })
        .first()
      if (!existing) {
        await db.savePlotArc({
          projectId: Number(id),
          type: 'conflict',
          description: desc,
          status: 'open',
          relatedChapter: 0,
        })
      }
    }
  }
}
```

需要在文件顶部 import 中增加 `savePlotArc` 和 import db：

```js
import db, { savePlotArc } from '../db'
```

（当前已有 `import { ... } from '../db'`，需要在原有 import 中追加 `savePlotArc`）

实际上，当前 import 行是 `import { ... } from '../db'`，直接追加即可。但 `db.plot_arcs.where(...)` 需要直接访问 db 实例。改为：

```js
import db, {
  getProject, updateProject,
  getCharactersByProject, getChaptersByProject,
  getProjectConversation, saveProjectConversation,
  getSetting, saveCharacter, saveChapter,
  savePlotArc,
} from '../db'
```

**Step 2: 更新人物设定时也提取角色弧光**

在 `processAIResponse` 的 `// 1. Extract and save characters` 逻辑中，每个新增/更新的角色，如果 `background` 包含冲突关键词（如"幸存者"、"仇恨"、"秘密"），自动写入 `plot_arcs`：

在角色保存循环内，添加：

```js
if (char.background && (char.background.includes('幸存') || char.background.includes('仇恨') || char.background.includes('秘密') || char.background.includes('封印'))) {
  const arcDesc = `${char.name}的角色弧光：${char.background}`
  const existing = await db.plot_arcs
    .where({ projectId: Number(id), description: arcDesc })
    .first()
  if (!existing) {
    await savePlotArc({
      projectId: Number(id),
      type: 'character_arc',
      description: arcDesc,
      status: 'open',
      relatedChapter: 0,
    })
  }
}
```

同时需要在 import 中增加 `db` 的直接引用（如上一步）。

**Step 3: 验证**

```bash
cd F:/StoryGenerater/myGenerater && npx vite build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add src/pages/ChatPage.jsx
git commit -m "feat: auto-extract plot arcs and character arcs during planning"
```

---

### Task 5: ProjectDashboard 伏笔展示

**Files:**
- Modify: `src/pages/ProjectDashboard.jsx`

**Step 1: 导入新的 DB 函数**

在 import 行追加：

```js
import {
  getProject, updateProject, deleteProject,
  getCharactersByProject, getChaptersByProject,
  saveCharacter, saveChapter, deleteCharacter, deleteChapter,
  getPlotArcsByProject, updatePlotArcStatus, deletePlotArc,
} from '../db'
```

**Step 2: 在组件中加载 plot arcs**

在 `load` 函数内增加：

```js
const load = async () => {
  const p = await getProject(id)
  if (!p) { navigate('/'); return }
  setProject(p)
  setCharacters(await getCharactersByProject(id))
  setChapters(await getChaptersByProject(id))
  setPlotArcs(await getPlotArcsByProject(id))  // <-- 新增
}
```

新增状态：

```js
const [plotArcs, setPlotArcs] = useState([])
```

**Step 3: 在 storyline tab 中展示伏笔**

在 storyline tab 的章节时间线之前，增加伏笔区块：

```jsx
{/* Plot Arcs section */}
{plotArcs.length > 0 && (
  <div className="card" style={{ marginBottom: 20 }}>
    <h3 style={{ fontSize: 14, marginBottom: 12, color: '#e94560' }}>📌 伏笔与冲突追踪</h3>
    {plotArcs.map((arc) => (
      <div
        key={arc.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 0',
          borderBottom: '1px solid #1a1a2e',
          fontSize: 13,
        }}
      >
        <span style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 4,
          background: arc.type === 'foreshadowing' ? '#0f3460' : arc.type === 'conflict' ? '#533483' : '#1a8a4a',
          color: '#ccc',
          flexShrink: 0,
        }}>
          {arc.type === 'foreshadowing' ? '伏笔' : arc.type === 'conflict' ? '冲突' : '角色弧'}
        </span>
        <span style={{ flex: 1 }}>{arc.description}</span>
        <span className={`chapter-status ${arc.status === 'open' ? 'status-planned' : 'status-done'}`} style={{ fontSize: 10 }}>
          {arc.status === 'open' ? '未解决' : '已解决'}
        </span>
        <button
          className="btn btn-secondary btn-sm"
          onClick={async () => {
            await updatePlotArcStatus(arc.id, arc.status === 'open' ? 'resolved' : 'open')
            load()
          }}
          style={{ fontSize: 10, padding: '2px 6px' }}
        >
          {arc.status === 'open' ? '标记解决' : '重新打开'}
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={async () => {
            await deletePlotArc(arc.id)
            load()
          }}
          style={{ fontSize: 10, padding: '2px 6px' }}
        >
          删
        </button>
      </div>
    ))}
  </div>
)}
```

**Step 4: 验证**

```bash
cd F:/StoryGenerater/myGenerater && npx vite build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add src/pages/ProjectDashboard.jsx
git commit -m "feat: display plot arcs and conflict tracking in dashboard storyline"
```

---

### Task 6: 端到端验证 + 样式微调

**Step 1: 完整构建**

```bash
cd F:/StoryGenerater/myGenerater && npx vite build 2>&1
```

Expected: Clean build, no errors, no unused variable warnings.

**Step 2: 启动 dev server 测试**

```bash
cd F:/StoryGenerater/myGenerater && npx vite --open 2>&1 &
```

测试流程：
1. 创建新项目 → 进入策划对话
2. 完成世界观 → 人物 → 章节规划（确认 ChatPage 正常）
3. 进入写作页面 → 选择章节 → 点击「流水线生成」
4. 观察四阶段进度条（大纲 → 草稿 → 审校 → 润色）
5. 点击「保存」→ 确认摘要自动提取（在 DevTools 查看 IndexedDB）
6. 返回总览 → storyline tab → 确认伏笔展示
7. 再生成下一章 → 确认前文摘要链传入

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: final build verification and cleanup"
```
