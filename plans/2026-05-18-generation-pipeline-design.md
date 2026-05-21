# 小说生成流水线改造设计

## 目标

参考 AI_NovelGenerator，提升 myGenerater 的章节生成质量和长程上下文能力。

## 核心改造

### 1. 多阶段生成流水线

将 WritePage 的「一键生成」改为四阶段流水线：

```
用户点击「生成」→ ① 详细大纲 → ② 草稿 → ③ 一致性审校 → ④ 润色终稿
```

- **① 详细大纲**：根据本章概要 + 前文上下文，扩写为包含场景列表、人物出场、关键对话节点的详细大纲
- **② 草稿**：根据详细大纲写正文
- **③ 一致性审校**：对照项目设定 + 前文摘要链 + 伏笔表，检查矛盾点
- **④ 润色终稿**：根据审校意见修改草稿，输出最终版本

每阶段一次 LLM 调用，UI 显示进度条和当前阶段名，可中途终止。

### 2. 智能摘要链

每章保存后自动生成结构化摘要（JSON），存入 `chapter_summaries` 表：

```json
{
  "summary": "本章事件概述（3-5句）",
  "characterChanges": "角色状态变化",
  "foreshadowing": "本章埋下的伏笔",
  "keyScenes": "本章关键场景"
}
```

写新章节时，将所有已完成章节的摘要链传入 prompt，替代现有的「早期章节时间线」。

### 3. 伏笔/状态追踪表

新增 `plot_arcs` 表追踪：

- `conflict`：未解决冲突
- `foreshadowing`：伏笔
- `character_arc`：角色弧光

写新章节时传入所有 `open` 状态的条目，提醒 AI。

### 4. 一致性审校

草稿生成后、终稿前插入审校调用。输入：项目设定 + 人物列表 + 前文摘要链 + 伏笔表 + 本章草稿。输出问题列表交润色阶段修复。

## 数据模型

新增 Dexie 表：

```js
chapter_summaries: '++id, chapterId'
plot_arcs: '++id, projectId, type, status'
```

## 文件改动

| 文件 | 改动 |
|------|------|
| `src/db/index.js` | 新增表 schema + CRUD 函数 |
| `src/pages/WritePage.jsx` | 流水线替换单次生成，新增进度条、中间结果展示、终止按钮 |
| `src/pages/ChatPage.jsx` | 策划阶段自动提取伏笔入 `plot_arcs` |
| 新增 `src/utils/summaryExtractor.js` | 摘要提取 + 一致性检查的 prompt 构建 |
| `src/pages/ProjectDashboard.jsx` | storyline tab 中展示伏笔/冲突追踪 |
