import Dexie from 'dexie'

const db = new Dexie('StoryGenerater')

db.version(4).stores({
  projects: '++id, title, status, createdAt',
  characters: '++id, projectId, name',
  chapters: '++id, projectId, number, status',
  conversations: '++id, projectId, mode',
  settings: 'key',
  chapter_summaries: '++id, chapterId',
  plot_arcs: '++id, projectId, type, status',
})

// ====== Projects ======

export async function createProject(title) {
  const now = Date.now()
  const id = await db.projects.add({
    title,
    genre: '',
    setting: '',
    synopsis: '',
    status: 'active',
    phase: 'planning',
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
    await db.chapters.update(chapter.id, chapter)
    return chapter.id
  }
  return await db.chapters.add(chapter)
}

export async function getChaptersByProject(projectId) {
  return await db.chapters
    .where({ projectId: Number(projectId) })
    .sortBy('number')
}

export async function getChapter(id) {
  return await db.chapters.get(Number(id))
}

export async function updateChapterContent(id, content) {
  await db.chapters.update(Number(id), { content, status: 'draft' })
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

export default db
