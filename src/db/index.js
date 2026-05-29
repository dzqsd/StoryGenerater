import Dexie from 'dexie'
import { countWords } from '../utils/wordCount'

let db
let dbAvailable = true

try {
  db = new Dexie('StoryGenerater')

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
} catch (err) {
  console.error('IndexedDB 初始化失败:', err)
  dbAvailable = false
  db = null
}

export function isDBAvailable() {
  return dbAvailable
}

// ====== Projects ======

export const WORD_COUNT_OPTIONS = [
  { value: '800-1200', label: '短篇 (800-1200字)', min: 800, target: 1000, max: 1200 },
  { value: '1200-2000', label: '标准 (1200-2000字)', min: 1200, target: 1500, max: 2000 },
  { value: '2000-3000', label: '中篇 (2000-3000字)', min: 2000, target: 2500, max: 3000 },
  { value: '3000-5000', label: '长篇 (3000-5000字)', min: 3000, target: 4000, max: 5000 },
]

export function getWordCountConfig(value) {
  return WORD_COUNT_OPTIONS.find((o) => o.value === value) || WORD_COUNT_OPTIONS[1]
}

export async function createProject(title, targetWordCount = '1200-2000') {
  const now = Date.now()
  const id = await db.projects.add({
    title,
    genre: '',
    setting: '',
    synopsis: '',
    status: 'active',
    phase: 'planning',
    targetWordCount,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function getProject(id) {
  return await db.projects.get(Number(id))
}

export async function getAllProjects() {
  return await db.projects.orderBy('createdAt').reverse().toArray()
}

export async function updateProject(id, updates) {
  await db.projects.update(Number(id), { ...updates, updatedAt: Date.now() })
}

export async function deleteProject(id) {
  const nid = Number(id)
  await db.projects.delete(nid)
  await db.characters.where({ projectId: nid }).delete()
  await db.chapters.where({ projectId: nid }).delete()
  await db.conversations.where({ projectId: nid }).delete()
}

// ====== Characters ======

export async function saveCharacter(char) {
  if (char.id) {
    await db.characters.update(char.id, char)
    return char.id
  }
  return await db.characters.add(char)
}

export async function getCharactersByProject(projectId) {
  return await db.characters.where({ projectId: Number(projectId) }).toArray()
}

export async function deleteCharacter(id) {
  await db.characters.delete(Number(id))
}

// ====== Chapters ======

export async function saveChapter(chapter) {
  if (chapter.id) {
    await db.chapters.update(chapter.id, { ...chapter, updatedAt: Date.now() })
    return chapter.id
  }
  return await db.chapters.add({ ...chapter, createdAt: Date.now(), updatedAt: Date.now() })
}

export async function getChaptersByProject(projectId) {
  return await db.chapters
    .where({ projectId: Number(projectId) })
    .sortBy('number')
}

export async function getChapter(id) {
  return await db.chapters.get(Number(id))
}

export async function updateChapterContent(id, content, status) {
  await db.chapters.update(Number(id), { content, status: status || 'draft', updatedAt: Date.now() })
}

export async function deleteChapter(id) {
  await db.chapters.delete(Number(id))
}

// ====== Conversations ======

export async function getProjectConversation(projectId, mode) {
  return await db.conversations
    .where({ projectId: Number(projectId), mode })
    .first()
}

export async function saveProjectConversation(projectId, mode, messages) {
  const existing = await db.conversations
    .where({ projectId: Number(projectId), mode })
    .first()

  if (existing) {
    await db.conversations.update(existing.id, {
      messages,
      createdAt: Date.now(),
    })
    return existing.id
  }
  return await db.conversations.add({
    projectId: Number(projectId),
    mode,
    messages,
    createdAt: Date.now(),
  })
}

export async function deleteProjectConversations(projectId) {
  await db.conversations.where({ projectId: Number(projectId) }).delete()
}

// ====== Settings ======

export async function getSetting(key) {
  const entry = await db.settings.get(key)
  return entry?.value ?? null
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value })
}

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

export default db
