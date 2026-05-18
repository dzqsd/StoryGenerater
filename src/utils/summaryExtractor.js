/**
 * Prompt builders and parsers for the 4-stage chapter generation pipeline.
 *
 * Stages: detailed outline → draft → consistency review → polish
 * Plus: structured chapter summary extraction after save.
 */

// ====== Context Assembly ======

export function buildContextBlock(project, characters, summaryChain, targetChapter) {
  const charBlock = characters.length > 0
    ? characters.map((c) => `- ${c.name}（${c.role}）：${c.traits || ''}；背景：${c.background || ''}`).join('\n')
    : '暂无'

  let summaryBlock = ''
  const prevChapters = summaryChain.filter((s) => s.chapter.number < targetChapter.number)
  if (prevChapters.length > 0) {
    summaryBlock = '====== 前文章节摘要链 ======\n'
    for (const { chapter, summary } of prevChapters) {
      if (summary) {
        summaryBlock += `第${chapter.number}章「${chapter.title}」：\n`
        summaryBlock += `  概要：${summary.summary || chapter.summary || '无'}\n`
        if (summary.characterChanges && summary.characterChanges !== '无') summaryBlock += `  角色变化：${summary.characterChanges}\n`
        if (summary.keyScenes && summary.keyScenes !== '无') summaryBlock += `  关键场景：${summary.keyScenes}\n`
        summaryBlock += '\n'
      } else {
        summaryBlock += `第${chapter.number}章「${chapter.title}」：${chapter.summary || '无摘要'}\n\n`
      }
    }
  }

  const targetIdx = summaryChain.findIndex((s) => s.chapter.number === targetChapter.number)
  let previousContent = ''
  if (targetIdx > 0) {
    const prev = summaryChain[targetIdx - 1]
    if (prev.chapter.content) {
      previousContent = `\n====== 上一章完整内容（确保衔接） ======\n${prev.chapter.content}\n`
    }
  }

  return { charBlock, summaryBlock, previousContent }
}

// ====== Stage 1: Detailed Outline ======

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

// ====== Stage 2: Draft ======

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

// ====== Stage 3: Consistency Review ======

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

// ====== Stage 4: Polish ======

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

// ====== Chapter Summary Extraction (after save) ======

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

export function parseChapterSummaryJSON(raw) {
  try {
    return JSON.parse(raw)
  } catch {
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
