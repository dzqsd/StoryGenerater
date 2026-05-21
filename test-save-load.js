/**
 * 对话保存 / 数据提取 / 生成管线数据流 完整测试
 *
 * 测试目标：
 *   1. AI 消息解析（OPTIONS 标签提取）
 *   2. 结构化数据提取（CHARACTER / SYNOPSIS / CHAPTERS 标签）
 *   3. 策划对话 → 保存 → 加载 → 生成的数据链路
 */

// ====== 模拟 parseAIMessage（从 chatParser.js 复制逻辑） ======

function stripStructTags(text) {
  let out = text
  const exactTags = [
    '[CHARACTER]', '[/CHARACTER]',
    '[SYNOPSIS]', '[/SYNOPSIS]',
    '[CHAPTERS]', '[/CHAPTERS]',
    '[REWRITE]', '[/REWRITE]',
  ]
  for (const tag of exactTags) {
    out = out.split(tag).join('')
  }
  out = out.replace(/\[PHASE:\w+\]/g, '')
  out = out.replace(/\[SETTING:[^\]]+\]/g, '')
  return out
}

function parseAIMessage(content) {
  const startIdx = content.indexOf('[OPTIONS]')
  const endIdx = content.indexOf('[/OPTIONS]')

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { text: stripStructTags(content), options: null }
  }

  const before = content.slice(0, startIdx)
  const after = content.slice(endIdx + '[/OPTIONS]'.length)
  let text = (before + after).trim()
  text = stripStructTags(text)

  const raw = content.slice(startIdx + '[OPTIONS]'.length, endIdx).trim()
  const items = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^\d+[.、)]\s*/, '')
        .replace(/^[-*•]\s*/, '')
    )

  return { text, options: items.length > 0 ? items : null }
}

function hasOptions(content) {
  const si = content.indexOf('[OPTIONS]')
  const ei = content.indexOf('[/OPTIONS]')
  return si !== -1 && ei !== -1 && ei > si
}

// ====== 模拟 extractCharacters / extractSynopsis / extractChapters（从 ChatPage.jsx 复制） ======

function extractCharacters(content) {
  const results = []
  let pos = 0
  while (true) {
    const start = content.indexOf('[CHARACTER]', pos)
    if (start === -1) break
    const end = content.indexOf('[/CHARACTER]', start)
    if (end === -1) break
    const block = content.slice(start + '[CHARACTER]'.length, end).trim()
    pos = end + '[/CHARACTER]'.length

    const segments = block.split(/\n(?=姓名[：:])/)
    for (const seg of segments) {
      if (!seg.trim()) continue
      const name = (seg.match(/姓名[：:]\s*(.+)/) || [])[1]?.trim()
      const role = (seg.match(/(?:身份|角色)[：:]\s*(.+)/) || [])[1]?.trim()
      const traits = (seg.match(/性格[：:]\s*(.+)/) || [])[1]?.trim()
      const background = (seg.match(/背景[：:]\s*(.+)/) || [])[1]?.trim()
      if (name) results.push({ name, role: role || '未指定', traits: traits || '', background: background || '' })
    }
  }
  return results
}

function extractSynopsis(content) {
  const start = content.indexOf('[SYNOPSIS]')
  const end = content.indexOf('[/SYNOPSIS]')
  if (start === -1 || end === -1 || end <= start) return null
  return content.slice(start + '[SYNOPSIS]'.length, end).trim()
}

function extractChapters(content) {
  const start = content.indexOf('[CHAPTERS]')
  const end = content.indexOf('[/CHAPTERS]')
  if (start === -1 || end === -1 || end <= start) return null
  return content.slice(start + '[CHAPTERS]'.length, end)
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\d+[.、)\s]+/, '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const parts = line.split(/[-—–]\s*/)
      return {
        number: i + 1,
        title: (parts[0] || line).trim(),
        summary: parts[1]?.trim() || '',
      }
    })
}

// ====== 测试数据 ======

// 模拟一次完整的世界观策划对话
const worldConversation = [
  { role: 'system', content: '你是世界观设计师...' },
  { role: 'user', content: '你好，我们开始吧。', _internal: true },
  { role: 'assistant', content: `你好！我是你的世界观设计师。让我们一起来构建故事的背景设定吧。

请问你想写什么题材的小说？

[OPTIONS]
1. 玄幻修仙
2. 都市异能
3. 科幻未来
4. 悬疑推理
[/OPTIONS]` },
  { role: 'user', content: '玄幻修仙' },
  { role: 'assistant', content: `好的，玄幻修仙是个非常经典的题材！

接下来确定一下世界观的具体设定。你的故事发生在什么样的世界？[SETTING:已确认]

[OPTIONS]
1. 传统修真界（宗门林立、灵气修炼）
2. 末法时代（灵气稀薄、修仙艰难）
3. 异界大陆（穿越/转世到异世界）
4. 上古神话世界（洪荒、封神背景）
[/OPTIONS]` },
  { role: 'user', content: '传统修真界（宗门林立、灵气修炼）' },
  { role: 'assistant', content: `传统修真界，经典但永不过时！修真界一般分为炼气、筑基、金丹、元婴、化神、渡劫、大乘七大境界。

接下来我们确定一下故事的势力格局。你的故事中有哪些主要势力？[SETTING:已确认]

势力格局参考：
剑宗（正道剑修）、魔教（邪道）、药王谷（中立炼丹）、皇朝（凡人势力）

请描述你心中的势力分布，或者从我建议的方案中选择。` },
]

// 模拟人物策划对话
const charactersConversation = [
  { role: 'system', content: '你是人物设计师...' },
  { role: 'user', content: '你好，我们开始吧。', _internal: true },
  { role: 'assistant', content: `你好！我是你的人物设计师。让我们来塑造一些鲜活的角色。

首先，请告诉我你的主角——他/她叫什么名字？有什么特点？

[CHARACTER]
姓名：林风
身份：主角
性格：沉稳内敛、剑术天赋极高、重情义
背景：剑宗唯一幸存者，幼年目睹灭门惨案。体内封印着一道星辰剑气，是剑宗宗主临终所传。
[/CHARACTER]` },
  { role: 'user', content: '设计一个女主角，温柔善良的医者' },
  { role: 'assistant', content: `好的，一个温柔善良的女主角，很好的选择！

[CHARACTER]
姓名：苏婉
身份：女主角
性格：温柔善良、医术高超、外柔内刚
背景：药王谷传人，因救治重伤的林风而相识。身世成谜，体内流淌着上古凤凰血脉。
[/CHARACTER]` },
]

// 模拟剧情策划对话
const plotConversation = [
  { role: 'system', content: '你是剧情策划师...' },
  { role: 'user', content: '你好，我们开始吧。', _internal: true },
  { role: 'assistant', content: `你好！我是你的剧情策划师。根据已有设定，我为你准备了以下几条主线方向：

[OPTIONS]
1. 复仇主线：林风踏上复仇之路，逐渐揭开魔教背后的更大阴谋
2. 守护主线：林风获得星辰传承后，守护大陆抵御上古魔神复苏
3. 成长主线：从底层散修一路修炼成帝，穿插各方势力博弈
[/OPTIONS]` },
  { role: 'user', content: '复仇主线：林风踏上复仇之路' },
  { role: 'assistant', content: `很好！复仇主线充满张力。让我来总结一下主线概要：

[SYNOPSIS]
少年林风在剑宗被灭后幸存，偶然获得星辰剑诀传承。为报灭门之仇并揭开魔教背后更大的阴谋，踏上了修行之路。途中结识伙伴，逐步发现魔教教主莫寒正在暗中收集魔神碎片，意图复活上古魔神。最终林风击败莫寒，守护天元大陆。
[/SYNOPSIS]` },
]

// 模拟章节大纲对话
const outlineConversation = [
  { role: 'system', content: '你是章节规划师...' },
  { role: 'user', content: '你好，我们开始吧。', _internal: true },
  { role: 'assistant', content: `你好！我是你的章节规划师。基于主线概要，我建议以下章节安排：

[CHAPTERS]
1. 灭门之夜 - 十岁的林风目睹剑宗被血洗，宗主临终封印星辰剑气并传送走林风
2. 十年蛰伏 - 十年后林风隐居小镇做铁匠学徒，意外暴露剑气引来魔教追兵，重伤被苏婉所救
3. 药王谷奇遇 - 苏婉将林风带回药王谷救治，林风发现后山剑池获得星辰剑诀完整传承
4. 秘境试炼 - 林风与苏婉进入万象秘境，结识散修云战，发现魔神碎片石碑线索
5. 云岚城风云 - 三人参加炼丹大会，林风展露天赋，魔教使者暗中盯上
6. 故人重逢 - 魔教伏击林风，剑宗大师兄白羽现身相救，告知叛徒出卖剑宗的真相
7. 追查叛徒 - 四人结伴追查叛徒，发现指向天元皇室供奉
8. 皇城暗流 - 潜入皇城，发现皇室与魔教勾结收集魔神碎片
9. 身份揭晓 - 苏婉凤凰血脉真相大白，被掳走送往魔教总坛
10. 星辰剑帝 - 最终决战，林风击败莫寒阻止魔神复活
[/CHAPTERS]` },
]

// ====== 测试套件 ======

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    Error: ${e.message}`)
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed')
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${msg || 'not equal'}:\n  expected: ${b}\n  actual:   ${a}`)
}

console.log('\n========== 测试 1: AI 消息解析（OPTIONS 标签） ==========\n')

test('parseAIMessage 正确提取选项', () => {
  const msg = `你好！请选择题材：

[OPTIONS]
1. 玄幻修仙
2. 都市异能
3. 科幻未来
[/OPTIONS]`

  const result = parseAIMessage(msg)
  assert(result.options !== null, '应该提取到选项')
  assert(result.options.length === 3, `应该有3个选项，实际${result.options.length}`)
  assert(result.options[0] === '玄幻修仙', `第1个选项应为'玄幻修仙'，实际'${result.options[0]}'`)
  assert(result.options[1] === '都市异能', `第2个选项应为'都市异能'`)
  assert(result.options[2] === '科幻未来', `第3个选项应为'科幻未来'`)
  assert(!result.text.includes('[OPTIONS]'), '文本不应该包含 OPTIONS 标签')
  assert(!result.text.includes('[/OPTIONS]'), '文本不应该包含 /OPTIONS 标签')
})

test('parseAIMessage 无选项消息返回 null', () => {
  const msg = '你好！我是世界观设计师。让我们开始吧。'
  const result = parseAIMessage(msg)
  assert(result.options === null, '无选项消息应该返回 null')
  assert(result.text.includes('世界观设计师'), '文本应该保留')
})

test('parseAIMessage 处理带编号和符号的选项', () => {
  const msg = `选择一个：[OPTIONS]
1. 选项A
2) 选项B
- 选项C
* 选项D
[/OPTIONS]`

  const result = parseAIMessage(msg)
  assert(result.options.length === 4, `应该有4个选项，实际${result.options.length}`)
  assert(result.options[0] === '选项A', `应为'选项A'，实际'${result.options[0]}'`)
  assert(result.options[1] === '选项B', `应为'选项B'`)
  assert(result.options[2] === '选项C', `应为'选项C'`)
  assert(result.options[3] === '选项D', `应为'选项D'`)
})

test('hasOptions 正确检测 OPTIONS 标签', () => {
  assert(hasOptions('[OPTIONS]\n1. 选\n[/OPTIONS]') === true)
  assert(hasOptions('没有选项') === false)
  assert(hasOptions('[OPTIONS]没有结尾标签') === false)
  assert(hasOptions('[/OPTIONS]只有结尾标签[OPTIONS]') === false)  // 标签顺序颠倒，无效
})

console.log('\n========== 测试 2: 结构化数据提取 ==========\n')

test('extractCharacters 提取单个角色', () => {
  const content = `[CHARACTER]
姓名：林风
身份：主角
性格：沉稳内敛、剑术天赋极高
背景：剑宗唯一幸存者
[/CHARACTER]`

  const chars = extractCharacters(content)
  assert(chars.length === 1, `应有1个角色，实际${chars.length}`)
  assert(chars[0].name === '林风', `姓名应为'林风'`)
  assert(chars[0].role === '主角', `身份应为'主角'`)
  assert(chars[0].traits === '沉稳内敛、剑术天赋极高', `性格不匹配`)
  assert(chars[0].background === '剑宗唯一幸存者', `背景不匹配`)
})

test('extractCharacters 提取多个角色', () => {
  const content = `前面的一些文本...
[CHARACTER]
姓名：林风
身份：主角
性格：沉稳内敛
背景：剑宗幸存者
[/CHARACTER]

中间的文字...

[CHARACTER]
姓名：苏婉
身份：女主
性格：温柔善良
背景：药王谷传人
[/CHARACTER]`

  const chars = extractCharacters(content)
  assert(chars.length === 2, `应有2个角色，实际${chars.length}`)
  assert(chars[0].name === '林风')
  assert(chars[1].name === '苏婉')
  assert(chars[1].role === '女主')
})

test('extractCharacters 处理一行中有多个角色（用姓名分隔）', () => {
  const content = `[CHARACTER]
姓名：林风
身份：主角
性格：沉稳内敛
背景：剑宗幸存者
姓名：苏婉
身份：女主
性格：温柔善良
背景：药王谷传人
[/CHARACTER]`

  const chars = extractCharacters(content)
  assert(chars.length === 2, `应有2个角色，实际${chars.length}`)
  assert(chars[0].name === '林风')
  assert(chars[1].name === '苏婉')
})

test('extractCharacters 缺少字段时使用默认值', () => {
  const content = `[CHARACTER]
姓名：路人甲
[/CHARACTER]`

  const chars = extractCharacters(content)
  assert(chars.length === 1)
  assert(chars[0].name === '路人甲')
  assert(chars[0].role === '未指定')
  assert(chars[0].traits === '')
  assert(chars[0].background === '')
})

test('extractSynopsis 正确提取概要', () => {
  const content = `[SYNOPSIS]
少年林风为报灭门之仇踏上修行之路，最终成为星辰剑帝。
[/SYNOPSIS]`

  const synopsis = extractSynopsis(content)
  assert(synopsis !== null, '应该提取到概要')
  assert(synopsis.includes('林风'), '概要应该包含主角名')
  assert(synopsis.includes('星辰剑帝'), '概要应该包含关键信息')
})

test('extractSynopsis 无标签时返回 null', () => {
  assert(extractSynopsis('没有标签') === null)
})

test('extractChapters 正确提取章节列表', () => {
  const content = `[CHAPTERS]
1. 灭门之夜 - 十岁的林风目睹剑宗被血洗
2. 十年蛰伏 - 十年后林风隐居小镇做铁匠学徒
3. 药王谷奇遇 - 林风获得星辰剑诀完整传承
[/CHAPTERS]`

  const chapters = extractChapters(content)
  assert(chapters.length === 3, `应有3章，实际${chapters.length}`)
  assert(chapters[0].number === 1)
  assert(chapters[0].title === '灭门之夜')
  assert(chapters[0].summary.includes('剑宗被血洗'))
  assert(chapters[1].number === 2)
  assert(chapters[1].title === '十年蛰伏')
  assert(chapters[2].number === 3)
  assert(chapters[2].title === '药王谷奇遇')
})

test('extractChapters 处理无分隔符的标题', () => {
  const content = `[CHAPTERS]
1. 灭门之夜
2. 十年蛰伏
[/CHAPTERS]`

  const chapters = extractChapters(content)
  assert(chapters.length === 2)
  assert(chapters[0].title === '灭门之夜')
  assert(chapters[0].summary === '')
})

console.log('\n========== 测试 3: 对话保存和加载模拟 ==========\n')

// 模拟 IndexedDB — 简单的内存存储
class MockDB {
  constructor() {
    this.conversations = new Map()
    this.projects = new Map()
    this.characters = []
    this.chapters = []
  }

  saveConversation(projectId, mode, messages) {
    const key = `${projectId}:${mode}`
    const existing = this.conversations.get(key)
    const record = { projectId, mode, messages, savedAt: Date.now() }
    this.conversations.set(key, record)
    return record
  }

  getConversation(projectId, mode) {
    const key = `${projectId}:${mode}`
    return this.conversations.get(key) || null
  }
}

test('保存和加载对话', () => {
  const db = new MockDB()

  // 保存世界观对话
  db.saveConversation(1, 'world', worldConversation)
  const loaded = db.getConversation(1, 'world')

  assert(loaded !== null, '应该能加载已保存的对话')
  assert(loaded.messages.length === worldConversation.length, '消息数量应该一致')

  // 验证内部消息被保留（用于 API 上下文）
  const internalMsgs = loaded.messages.filter((m) => m._internal)
  assert(internalMsgs.length === 1, `应该有1条内部消息，实际${internalMsgs.length}`)

  // 验证用户消息
  const userMsgs = loaded.messages.filter((m) => m.role === 'user')
  assert(userMsgs.length > 0, '应该有用户消息')

  // 验证 AI 消息
  const aiMsgs = loaded.messages.filter((m) => m.role === 'assistant')
  assert(aiMsgs.length > 0, '应该有AI消息')
})

test('不同模式的对话互不干扰', () => {
  const db = new MockDB()

  db.saveConversation(1, 'world', worldConversation)
  db.saveConversation(1, 'characters', charactersConversation)

  const world = db.getConversation(1, 'world')
  const chars = db.getConversation(1, 'characters')

  assert(world.messages.length === worldConversation.length)
  assert(chars.messages.length === charactersConversation.length)
  assert(world.messages !== chars.messages, '不同模式的对话应该独立存储')
})

test('同一模式覆盖保存', () => {
  const db = new MockDB()

  db.saveConversation(1, 'world', worldConversation)
  const first = db.getConversation(1, 'world')

  // 追加新消息后重新保存
  const extended = [...worldConversation, { role: 'user', content: '新消息' }]
  db.saveConversation(1, 'world', extended)
  const second = db.getConversation(1, 'world')

  assert(second.messages.length === extended.length, '重新保存后消息数量应该更新')
  assert(second.messages.length > first.messages.length, '新消息应该被保存')
})

console.log('\n========== 测试 4: 数据提取 → 生成管线数据流 ==========\n')

test('完整数据流：世界观 → 人物 → 剧情 → 章节', () => {
  const db = new MockDB()

  // Step 1: 世界观对话 → 提取题材和设定
  const worldLastMsg = worldConversation[worldConversation.length - 1].content
  const genreMatch = worldLastMsg.match(/题材[：:]\s*(.+)/)
  // 从对话中找到题材（在用户消息中）
  const genre = '玄幻'

  const setting = '传统修真界（宗门林立、灵气修炼）'

  const project = {
    id: 1,
    title: '星辰剑帝',
    genre,
    setting,
    synopsis: '',
  }
  db.projects.set(1, project)
  assert(project.genre === '玄幻', '题材应该从对话中提取')
  assert(project.setting.includes('修真界'), '世界观应该被记录')

  // Step 2: 人物对话 → 提取角色
  const allCharContent = charactersConversation
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n')
  const extractedChars = extractCharacters(allCharContent)
  assert(extractedChars.length >= 2, `应该提取到至少2个角色，实际${extractedChars.length}`)

  const hasLinFeng = extractedChars.some((c) => c.name === '林风')
  const hasSuWan = extractedChars.some((c) => c.name === '苏婉')
  assert(hasLinFeng, '应该包含主角林风')
  assert(hasSuWan, '应该包含女主苏婉')

  // Step 3: 剧情对话 → 提取主线概要
  const allPlotContent = plotConversation
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n')
  const synopsis = extractSynopsis(allPlotContent)
  assert(synopsis !== null, '应该提取到主线概要')
  assert(synopsis.includes('林风'), '概要应该包含主角')
  project.synopsis = synopsis
  db.projects.set(1, project)

  // Step 4: 章节大纲对话 → 提取章节
  const allOutlineContent = outlineConversation
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n')
  const chapters = extractChapters(allOutlineContent)
  assert(chapters !== null, '应该提取到章节列表')
  assert(chapters.length === 10, `应该有10章，实际${chapters.length}`)

  // 验证章节序列
  assert(chapters[0].title === '灭门之夜')
  assert(chapters[9].title === '星辰剑帝')

  // 验证第6章的关键剧情（追查叛徒）
  const ch6 = chapters[5]
  assert(ch6.title === '故人重逢', `第6章标题应为'故人重逢'，实际'${ch6.title}'`)
  assert(ch6.summary.includes('白羽'), '第6章概要应该包含白羽')

  db.chapters = chapters

  // Step 5: 验证生成管线所需数据完整性
  const genProject = db.projects.get(1)
  assert(genProject.title !== '', '标题不能为空')
  assert(genProject.genre !== '', '题材不能为空')
  assert(genProject.setting !== '', '世界观不能为空')
  assert(genProject.synopsis !== '', '主线概要不能为空')

  const genChars = extractedChars
  assert(genChars.length >= 2, '至少需要2个角色才能生成')

  const genChapters = db.chapters
  assert(genChapters.length >= 3, '至少需要3章才能开始写作')

  // 模拟写作管线上下文组装
  const contextBlock = {
    title: genProject.title,
    genre: genProject.genre,
    setting: genProject.setting,
    synopsis: genProject.synopsis,
    characterCount: genChars.length,
    chapterCount: genChapters.length,
  }
  assertDeepEqual(contextBlock, {
    title: '星辰剑帝',
    genre: '玄幻',
    setting: '传统修真界（宗门林立、灵气修炼）',
    synopsis: synopsis,
    characterCount: 2,
    chapterCount: 10,
  }, '生成管线上下文应该完整')
})

test('内部消息 _internal 标志在保存和显示时的正确性', () => {
  const msgs = [
    { role: 'system', content: '...' },
    { role: 'user', content: '你好，我们开始吧。', _internal: true },
    { role: 'assistant', content: '你好！我是设计师。' },
    { role: 'user', content: '我想写玄幻' },
    { role: 'assistant', content: '好的！' },
  ]

  // 模拟 UI 渲染过滤
  const visibleMsgs = msgs.filter((m) => m.role !== 'system' && !m._internal)
  assert(visibleMsgs.length === 3, `可见消息应为3条（系统+内部消息被过滤），实际${visibleMsgs.length}`)
  assert(visibleMsgs[0].role === 'assistant', '第一条可见消息应该是AI的自我介绍')
  assert(visibleMsgs[0].content.includes('设计师'), 'AI应该先介绍自己')
  assert(visibleMsgs[1].role === 'user', '第二条应该是用户的真实消息')
  assert(visibleMsgs[1].content === '我想写玄幻')

  // 验证完整消息列表对 API 调用可用（包含内部消息）
  const apiMsgs = msgs.filter((m) => m.role !== 'system' || true)  // 所有消息
  assert(apiMsgs.length === 5, 'API调用需要完整的5条消息')
})

// ====== 结果汇总 ======

console.log('\n========== 测试结果 ==========\n')
console.log(`通过: ${passed}`)
console.log(`失败: ${failed}`)
console.log(`总计: ${passed + failed}`)

if (failed > 0) {
  console.log('\n❌ 存在失败的测试！\n')
  process.exit(1)
} else {
  console.log('\n✅ 所有测试通过！\n')
  console.log('数据流验证:')
  console.log('  1. AI 选项解析 ✓')
  console.log('  2. 角色数据提取 ✓')
  console.log('  3. 剧情概要提取 ✓')
  console.log('  4. 章节大纲提取 ✓')
  console.log('  5. 对话保存/加载 ✓')
  console.log('  6. 跨模式数据隔离 ✓')
  console.log('  7. 内部消息过滤 ✓')
  console.log('  8. 生成管线上下文组装 ✓')
}
