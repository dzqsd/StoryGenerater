# 小说工坊 (Story Generator)

AI 辅助中文小说创作工具 —— 基于 DeepSeek 大模型的浏览器端 SPA，从世界观构思到章节润色，覆盖小说创作全流程。

## 功能特性

### 策划阶段（5 大 AI 对话模块）
- **总策划** — 全能顾问，可同时提取角色、章节、世界观等所有结构化数据
- **世界观** — 设计故事背景、题材、设定体系，确认后自动保存
- **人物** — 创建角色档案（姓名、身份、性格、背景），AI 辅助丰富细节
- **章节** — 章节划分与大纲生成，支持可视化时间线，可产出主线概要
- **修订** — 对已完成章节进行讨论和修改建议

### 写作阶段（4 阶段 AI 流水线）
1. **详细大纲** — 生成 300-500 字章节大纲（冲突、场景、对话节点、情感节奏）
2. **初稿** — 生成 1200-2000 字正文，保持文风一致
3. **一致性审查** — 对照设定、前文摘要链、开放伏笔检查连贯性
4. **润色** — 根据审查意见修改完善

支持**单章生成**和**批量生成**（自动按顺序写完所有待写章节）。

### 阅读与导出
- 电子书风格阅读器，键盘左右键翻章
- 单章节 / 全书 TXT 导出

### 数据管理
- 所有数据存储在浏览器 IndexedDB 中，无需后端服务器
- 项目、角色、章节、对话记录、伏笔追踪全部本地持久化
- API Key 仅保存在本地浏览器

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 18 |
| 路由 | React Router DOM v6 |
| 构建工具 | Vite 5 |
| 本地数据库 | Dexie.js (IndexedDB) |
| AI API | DeepSeek API (`deepseek-v4-flash`) |
| 样式 | 纯 CSS（~1900 行自定义设计系统） |
| 字体 | Archivo / Space Grotesk / Noto Serif SC |

## 项目结构

```
src/
├── api/
│   └── deepseek.js          # DeepSeek API 流式调用封装
├── components/
│   ├── Layout.jsx            # 侧边栏 + 主内容区布局
│   ├── ChatMessage.jsx       # 聊天消息气泡（含选项按钮）
│   ├── CharacterCard.jsx     # 角色展示卡片
│   ├── ChapterItem.jsx       # 章节列表项
│   └── PhaseIndicator.jsx    # 阶段进度指示器（已废弃）
├── db/
│   └── index.js              # Dexie 数据库 schema + CRUD 操作
├── pages/
│   ├── HomePage.jsx          # 首页（项目列表 + 创建）
│   ├── ProjectDashboard.jsx  # 项目仪表盘（5 标签页）
│   ├── ChatPage.jsx          # AI 策划对话页
│   ├── WritePage.jsx         # 写作编辑器 + 流水线
│   ├── ReadPage.jsx          # 电子书阅读器
│   └── SettingsPage.jsx      # API Key / 参数设置
├── utils/
│   ├── chatModes.js          # 5 种对话模式定义（系统提示词 + 数据提取）
│   ├── chatParser.js         # AI 消息解析（选项提取、标签剥离）
│   ├── chapterPipeline.js    # 4 阶段生成流水线编排
│   └── summaryExtractor.js   # 流水线提示词 + JSON 摘要解析
├── styles/
│   └── global.css            # 全局样式
├── App.jsx                   # 根组件（路由定义）
└── main.jsx                  # 应用入口
```

## 快速开始

### 环境要求
- Node.js >= 18
- DeepSeek API Key（在 [DeepSeek 开放平台](https://platform.deepseek.com/) 获取）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/dzqsd/StoryGenerater.git
cd StoryGenerater

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 配置

1. 启动应用后，进入「设置」页面
2. 填入 DeepSeek API Key
3. 调整温度（0.1-1.5）和最大 Token 数（2048-16384）
4. 点击保存，配置自动持久化到浏览器本地

## 使用指南

### 1. 创建项目
在首页输入小说名称，点击创建。项目初始阶段为「策划」。

### 2. 策划小说
进入项目后，依次使用 5 个策划模块：
- 先与「世界观」对话确定故事背景
- 用「人物」模块创建主要角色
- 通过「章节」划分章节并产出主线概要

AI 回复中的结构化数据（角色信息、主线概要、章节结构）会自动解析并保存到数据库。

### 3. 写作
进入「写作」页面：
- 选择一个章节，点击「AI 流水线」按钮
- 流水线自动执行：大纲 → 初稿 → 审查 → 润色
- 也可以使用「批量生成」一次性写完所有待写章节
- 生成的内容会在左侧面板实时更新

### 4. 阅读与导出
- 在「阅读」页面享受纯净的阅读体验
- 使用「导出 TXT」功能获取完整文本

## 数据存储

所有数据使用 IndexedDB 存储在浏览器中，包含 7 张表：

| 表 | 用途 |
|----|------|
| projects | 项目元数据（标题、题材、世界观、概要） |
| characters | 角色档案（姓名、身份、性格、背景） |
| chapters | 章节内容与状态（planned/draft/done） |
| conversations | 各模式 AI 对话历史 |
| settings | API Key 与生成参数 |
| chapter_summaries | 每章结构化摘要（用于跨章连贯性） |
| plot_arcs | 伏笔/冲突/角色弧光追踪 |

## License

MIT
