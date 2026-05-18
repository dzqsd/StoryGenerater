/**
 * 多章节连贯性测试脚本
 *
 * 测试目标：验证 AI 在生成后续章节时，能否记住前文的内容、时间线和剧情细节。
 *
 * 测试场景：一个 10 章的玄幻小说，测试：
 *   A) 仅提供章节摘要（模拟当前代码行为）
 *   B) 提供前 N 章完整内容（改进后的行为）
 *
 * 对比两种模式下 AI 对早期章节细节的回忆能力。
 */

const API_BASE = 'https://api.deepseek.com/v1'
const API_KEY = 'sk-30c1e7d7c3d646bd941e683f304b6495'

// ====== 测试故事设定 ======

const PROJECT = {
  title: '星辰剑帝',
  genre: '玄幻',
  setting: '天元大陆，灵气为修行之本。分为炼气、筑基、金丹、元婴、化神、渡劫、大乘七大境界。剑宗为天下第一宗门，百年前遭魔教灭门。',
  synopsis: '少年林风在剑宗被灭后幸存，偶然获得星辰剑诀传承。为报灭门之仇并揭开魔教背后更大的阴谋，踏上了修行之路。途中结识伙伴，最终成为星辰剑帝，守护天元大陆。',
}

const CHARACTERS = [
  { name: '林风', role: '主角', traits: '沉稳内敛、剑术天赋极高、重情义', background: '剑宗唯一幸存者，幼年目睹灭门惨案。体内封印着一道星辰剑气，是剑宗宗主临终所传。' },
  { name: '苏婉', role: '女主', traits: '温柔善良、医术高超、外柔内刚', background: '药王谷传人，因救治重伤的林风而相识。身世成谜，体内流淌着上古凤凰血脉。' },
  { name: '云战', role: '配角（兄弟）', traits: '豪爽直率、力大无穷、讲义气', background: '散修出身，在一次秘境探险中与林风结为兄弟。天生神力，擅长斧法。' },
  { name: '莫寒', role: '反派', traits: '阴险狡诈、野心极大、修为深不可测', background: '魔教教主，百年前策划剑宗灭门。真实身份是上古魔神的转世容器，正在暗中收集魔神碎片。' },
  { name: '白羽', role: '配角（师兄）', traits: '冷漠孤傲、外冷内热、剑痴', background: '剑宗大师兄，灭门时在外历练幸免。十年后得知林风还活着，暗中帮助。修炼寒冰剑诀。' },
]

// ====== 详细章节设定（包含具体细节，用于验证 AI 是否记得） ======

const CHAPTERS = [
  { number: 1, title: '灭门之夜', summary: '十年前的剑宗灭门之夜。十岁的林风目睹宗门被血洗，宗主在临终前将一道星辰剑气封印在他体内，用传送阵将他送走。林风发誓报仇。' },
  { number: 2, title: '十年蛰伏', summary: '十年后，林风在偏远小镇以铁匠学徒身份隐居，暗中修炼。一次意外暴露了剑气，引来魔教追兵。激战中林风重伤坠崖，被采药的苏婉所救。' },
  { number: 3, title: '药王谷', summary: '苏婉将林风带回药王谷救治。林风在谷中养伤期间，发现药王谷后山有一处上古剑池——正是星辰剑诀的起源之地。林风在剑池中获得星辰剑诀完整传承。' },
  { number: 4, title: '秘境试炼', summary: '林风与苏婉前往万象秘境试炼，遇到散修云战。三人联手击败秘境守护兽，获得天材地宝。林风在秘境中发现一块刻有"魔神碎片"字样的石碑，隐隐感觉与灭门有关。' },
  { number: 5, title: '云岚城风云', summary: '三人来到云岚城参加炼丹大会。林风在丹会上展现出惊人天赋（剑诀中附带的丹道知识），引起各方势力关注。魔教使者暗中盯上了林风。' },
  { number: 6, title: '故人重逢', summary: '林风被魔教使者伏击，危急时刻白羽现身相救。师兄弟重逢，白羽告知林风：灭门并非偶然，有人出卖了剑宗。叛徒如今还在天元大陆活跃。林风震惊。' },
  { number: 7, title: '追查叛徒', summary: '林风、白羽、苏婉、云战四人结伴，循线索追查叛徒。途中遭遇魔教多次阻截。最终发现叛徒指向天元皇室的供奉——一位化神境高手。' },
  { number: 8, title: '皇城暗流', summary: '四人潜入皇城。林风发现皇室与魔教暗中勾结，正在大陆各地收集魔神碎片。而莫寒的身影也开始频繁出现。林风在皇城中意外得知苏婉的凤凰血脉与魔神有关。' },
  { number: 9, title: '身份揭晓', summary: '真相大白：苏婉是上古凤凰神的转世，而莫寒收集魔神碎片是为了复活真正的魔神。林风体内的星辰剑气是唯一能克制魔神的力量。苏婉被抓走送往魔教总坛。' },
  { number: 10, title: '星辰剑帝', summary: '最终决战。林风率众攻入魔教总坛，与莫寒展开生死之战。在苏婉凤凰之力的加持下，林风的星辰剑气彻底觉醒，击败莫寒，阻止了魔神复活。天元大陆恢复和平，林风被封为星辰剑帝。' },
]

// ====== 测试用的关键细节（散布在不同章节中，用于验证连贯性） ======

const KEY_DETAILS = {
  chapter1: [
    '林风十岁时目睹灭门',
    '宗主临终前封印星辰剑气',
    '传送阵将林风送走',
  ],
  chapter2: [
    '林风身份是铁匠学徒',
    '在小镇隐居十年',
    '重伤坠崖被苏婉所救',
  ],
  chapter3: [
    '药王谷后山有上古剑池',
    '在剑池中获得星辰剑诀完整传承',
    '苏婉是药王谷传人',
  ],
  chapter4: [
    '遇到的散修叫云战',
    '秘境石碑上刻有"魔神碎片"',
    '获得天材地宝',
  ],
  chapter5: [
    '在云岚城参加炼丹大会',
    '剑诀中附带的丹道知识',
    '魔教使者盯上林风',
  ],
  chapter6: [
    '白羽是剑宗大师兄',
    '修炼的是寒冰剑诀',
    '叛徒出卖了剑宗',
  ],
  chapter7: [
    '叛徒是天元皇室供奉',
    '化神境高手',
    '四人结伴追查',
  ],
}

// ====== API 调用函数 ======

async function chat(messages, maxTokens = 4096) {
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages,
      temperature: 0.8,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error (${response.status})`)
  }

  const json = await response.json()
  return json.choices[0].message.content
}

// ====== 测试 A：仅用摘要（模拟当前 bug） ======

function buildPromptSummaryOnly(targetChapter, previousContents) {
  const charList = CHARACTERS.map(
    (c) => `- ${c.name}（${c.role}）：${c.traits}；背景：${c.background}`
  ).join('\n')

  const chapterList = CHAPTERS.map(
    (c) => `第${c.number}章「${c.title}」- ${c.summary}`
  ).join('\n')

  // 当前代码行为：上一章只用摘要
  const idx = CHAPTERS.findIndex((c) => c.number === targetChapter.number)
  const prev = idx > 0 ? CHAPTERS[idx - 1] : null
  const next = idx < CHAPTERS.length - 1 ? CHAPTERS[idx + 1] : null

  return `你是一位专业小说作家。根据以下设定，撰写指定章节的正文。

====== 作品设定 ======
- 标题：${PROJECT.title}
- 题材：${PROJECT.genre}
- 世界观/背景：${PROJECT.setting}
- 主线概要：${PROJECT.synopsis}

====== 人物列表 ======
${charList}

====== 所有章节目录（仅有摘要） ======
${chapterList}

====== 当前任务 ======
撰写「第${targetChapter.number}章 ${targetChapter.title}」
章节概要：${targetChapter.summary}
${prev ? `前情（第${prev.number}章「${prev.title}」）：${prev.summary}` : '这是第一章。'}
${next ? `后续（第${next.number}章「${next.title}」）：${next.summary}` : '这是最后一章。'}

要求：
1. 字数 800-1200 字
2. 保持人物性格统一
3. 注意与前章衔接到位
4. 纯文本，不使用 markdown 格式
5. 直接写正文，不要加"第X章"标题`
}

// ====== 测试 B：包含前章完整内容（改进方案） ======

function buildPromptWithContext(targetChapter, previousContents) {
  const charList = CHARACTERS.map(
    (c) => `- ${c.name}（${c.role}）：${c.traits}；背景：${c.background}`
  ).join('\n')

  const chapterList = CHAPTERS.map(
    (c) => `第${c.number}章「${c.title}」- ${c.summary}`
  ).join('\n')

  const idx = CHAPTERS.findIndex((c) => c.number === targetChapter.number)

  // 构建前情提要：包含前面所有章节的完整内容
  let contextSection = ''
  if (previousContents && Object.keys(previousContents).length > 0) {
    const sortedNums = Object.keys(previousContents)
      .map(Number)
      .sort((a, b) => a - b)

    contextSection = '\n====== 已完成的章节正文（请严格记住以下所有细节） ======\n'
    for (const num of sortedNums) {
      const chap = CHAPTERS.find((c) => c.number === num)
      contextSection += `\n--- 第${num}章「${chap?.title || ''}」正文 ---\n${previousContents[num]}\n`
    }
  }

  const prev = idx > 0 ? CHAPTERS[idx - 1] : null
  const next = idx < CHAPTERS.length - 1 ? CHAPTERS[idx + 1] : null

  return `你是一位专业小说作家。根据以下设定，撰写指定章节的正文。

====== 作品设定 ======
- 标题：${PROJECT.title}
- 题材：${PROJECT.genre}
- 世界观/背景：${PROJECT.setting}
- 主线概要：${PROJECT.synopsis}

====== 人物列表 ======
${charList}

====== 所有章节目录 ======
${chapterList}
${contextSection}

====== 当前任务 ======
撰写「第${targetChapter.number}章 ${targetChapter.title}」
章节概要：${targetChapter.summary}
${prev ? `请确保与第${prev.number}章结尾衔接到位。` : '这是第一章。'}
${next ? `下一章概要（参考，不要跳到下一章剧情）：${next.summary}` : '这是最后一章。'}

要求：
1. 字数 800-1200 字
2. 保持人物性格统一，文风一致
3. 注意与前章衔接到位
4. 纯文本，不使用 markdown 格式
5. 直接写正文，不要加"第X章"标题`
}

// ====== 核心测试：生成章节并验证连贯性 ======

async function testCoherence(testName, buildPromptFn, chaptersToGenerate, previousContentsParam = null) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`测试: ${testName}`)
  console.log(`${'='.repeat(60)}`)

  const previousContents = previousContentsParam || {}
  const results = []

  for (const chapter of chaptersToGenerate) {
    const prompt = buildPromptFn(chapter, previousContents)
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: `请开始写第${chapter.number}章「${chapter.title}」的正文。` },
    ]

    console.log(`\n--- 正在生成第${chapter.number}章「${chapter.title}」 ---`)

    try {
      const content = await chat(messages, 8192)
      previousContents[chapter.number] = content

      // 检查是否引用了前文细节
      const references = checkReferences(content, chapter.number, previousContents)

      results.push({
        chapter: chapter.number,
        title: chapter.title,
        content: content.slice(0, 200) + '...',
        references,
        wordCount: content.length,
      })

      console.log(`  字数: ${content.length}`)
      console.log(`  引用前文细节: ${references.length} 处`)
      if (references.length > 0) {
        references.forEach((r) => console.log(`    - ${r}`))
      }
    } catch (err) {
      console.error(`  生成失败: ${err.message}`)
      results.push({
        chapter: chapter.number,
        title: chapter.title,
        content: '',
        references: [],
        wordCount: 0,
        error: err.message,
      })
    }
  }

  return results
}

// ====== 检查引用前文细节 ======

function checkReferences(content, currentChapterNum, previousContents) {
  const references = []

  // 检查是否引用了前面章节的关键细节
  for (const [chapNum, details] of Object.entries(KEY_DETAILS)) {
    const num = parseInt(chapNum.replace('chapter', ''))
    if (num >= currentChapterNum) continue

    for (const detail of details) {
      // 提取关键词进行模糊匹配
      const keywords = extractKeywords(detail)
      let matched = 0
      for (const kw of keywords) {
        if (content.includes(kw)) matched++
      }
      if (matched >= keywords.length * 0.5 && keywords.length > 0) {
        references.push(`✓ 记得[第${num}章]：${detail}`)
      }
    }
  }

  return references
}

// ====== 提取中文关键词（简单版，取2-3字片段） ======

function extractKeywords(text) {
  // 提取关键人物名、地名、物品名
  const patterns = [
    '林风', '苏婉', '云战', '莫寒', '白羽',
    '星辰剑气', '星辰剑诀', '凤凰血脉', '寒冰剑诀',
    '药王谷', '剑池', '魔神碎片', '万象秘境', '云岚城', '天元皇城',
    '铁匠', '炼丹大会', '叛徒', '化神境',
    '传送阵', '灭门', '剑宗',
  ]

  return patterns.filter((p) => text.includes(p))
}

// ====== 量化连贯性评分 ======

async function runQuantitativeTest(testName, buildPromptFn) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`量化测试: ${testName}`)
  console.log(`${'='.repeat(60)}`)

  const previousContents = {}
  let totalReferences = 0
  const chapterResults = []

  // 先生成前 5 章
  for (let i = 0; i < 5; i++) {
    const chapter = CHAPTERS[i]
    const prompt = buildPromptFn(chapter, previousContents)
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: `请开始写第${chapter.number}章「${chapter.title}」的正文。` },
    ]

    console.log(`生成第${chapter.number}章...`)
    try {
      const content = await chat(messages, 8192)
      previousContents[chapter.number] = content
      console.log(`  完成，${content.length} 字`)
    } catch (err) {
      console.error(`  失败: ${err.message}`)
      previousContents[chapter.number] = `[第${chapter.number}章生成失败]`
    }
  }

  // 测试第 8 章（看是否还记得前 5 章的内容）
  console.log(`\n--- 关键测试：生成第 8 章，检查是否记住前文 ---`)
  const chapter8 = CHAPTERS[7]
  const prompt8 = buildPromptFn(chapter8, previousContents)
  const messages8 = [
    { role: 'system', content: prompt8 },
    { role: 'user', content: `请开始写第${chapter8.number}章「${chapter8.title}」的正文。` },
  ]

  try {
    const content8 = await chat(messages8, 8192)
    console.log(`第 8 章完成，${content8.length} 字`)

    // 验证 AI 是否记得早期章节的关键细节
    console.log(`\n====== 连贯性验证 ======`)

    const checks = [
      { from: 1, detail: '传送阵', question: '是否提到林风当年被传送阵送走？' },
      { from: 1, detail: '星辰剑气', question: '是否提到星辰剑气是宗主所传？' },
      { from: 2, detail: '铁匠', question: '是否记得林风做过铁匠学徒？' },
      { from: 2, detail: '苏婉', question: '是否提到苏婉救了重伤的林风？' },
      { from: 3, detail: '剑池', question: '是否记得剑诀来自药王谷剑池？' },
      { from: 4, detail: '魔神碎片', question: '是否提到秘境中的魔神碎片石碑？' },
      { from: 4, detail: '云战', question: '是否记得云战是在秘境中结识的？' },
      { from: 5, detail: '炼丹', question: '是否记得炼丹大会的经历？' },
      { from: 6, detail: '白羽', question: '是否记得白羽是剑宗大师兄？' },
      { from: 6, detail: '叛徒', question: '是否提到剑宗被叛徒出卖？' },
      { from: 7, detail: '化神境', question: '是否提到叛徒是化神境高手？' },
      { from: 7, detail: '皇城', question: '是否记得四人追踪到了皇城？' },
    ]

    let passed = 0
    for (const check of checks) {
      const found = content8.includes(check.detail)
      if (found) {
        console.log(`  ✓ 第${check.from}章 "${check.detail}" — 已记住`)
        passed++
      } else {
        console.log(`  ✗ 第${check.from}章 "${check.detail}" — 未提及`)
      }
    }

    const score = Math.round((passed / checks.length) * 100)
    console.log(`\n连贯性得分: ${passed}/${checks.length} = ${score}%`)

    chapterResults.push({ chapter: 8, score, passed, total: checks.length, content: content8.slice(0, 500) })
    totalReferences = passed
  } catch (err) {
    console.error(`第 8 章失败: ${err.message}`)
    chapterResults.push({ chapter: 8, score: 0, error: err.message })
  }

  return { totalReferences, chapterResults }
}

// ====== 主测试流程 ======

async function main() {
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║     多章节 AI 连贯性测试                          ║')
  console.log('║     测试 10 章玄幻小说《星辰剑帝》                ║')
  console.log('╚══════════════════════════════════════════════════╝')

  // 测试 A：仅用摘要（当前代码行为 — 有 bug）
  console.log('\n\n████ 测试 A：仅摘要模式（当前代码行为）████')
  const resultA = await runQuantitativeTest('仅摘要模式', buildPromptSummaryOnly)

  // 测试 B：包含前章完整内容（改进方案）
  console.log('\n\n████ 测试 B：完整上下文模式（改进方案）████')
  const resultB = await runQuantitativeTest('完整上下文模式', buildPromptWithContext)

  // 汇总对比
  console.log('\n\n')
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║                  测试结果汇总                     ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`
  ┌─────────────────────┬──────────┬──────────┐
  │ 测试模式            │ 连贯性   │ 通过率   │
  ├─────────────────────┼──────────┼──────────┤
  │ A: 仅摘要（当前）   │ ${String(resultA.totalReferences).padEnd(8)} │ ${String(Math.round((resultA.totalReferences / 12) * 100) + '%').padEnd(8)} │
  │ B: 完整上下文（改进）│ ${String(resultB.totalReferences).padEnd(8)} │ ${String(Math.round((resultB.totalReferences / 12) * 100) + '%').padEnd(8)} │
  └─────────────────────┴──────────┴──────────┘
  `)

  if (resultB.totalReferences > resultA.totalReferences) {
    console.log(`✓ 结论：完整上下文模式显著提升了 AI 的连贯性（+${resultB.totalReferences - resultA.totalReferences} 项细节被记住）`)
  } else {
    console.log(`→ 两种模式表现相近，可能需要更大的章节量来体现差异`)
  }
}

main().catch(console.error)
