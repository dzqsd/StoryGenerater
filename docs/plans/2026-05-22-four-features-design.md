# 四大功能增强设计文档

日期: 2026-05-22 | 状态: 已确认

---

## 概述

为小说工坊新增四个功能：暗色模式、写作统计仪表盘、角色关系图谱、版本历史。

---

## A. 暗色模式

### 方案

CSS 变量切换，用户手动控制。`<html data-theme="dark">` 覆盖变量值，`localStorage` 持久化选择。

### 实施

1. `global.css` 所有颜色值抽取到 `:root` 下（约 40-50 个变量）
2. 新增 `[data-theme="dark"]` 选择器，低对比度暖暗色调
3. 新建 `src/hooks/useDarkMode.js`：初始化读 localStorage，切换时更新 `document.documentElement.dataset.theme`
4. 侧边栏底部加日/月切换按钮

### 暗色调色板

- 背景: `#1a1a2e` → `#16213e`
- 卡片: `#1f2940`
- 文字: `#c8c8d0`
- 强调色: `#6B74A8` → `#8B94C8`（提亮）

### 涉及文件

- 新建: `src/hooks/useDarkMode.js`
- 修改: `src/styles/global.css`, `src/components/Layout.jsx`

---

## B. 写作统计仪表盘

### 方案

纯数据卡片，嵌入项目仪表盘总览 tab，在现有 4 张概览卡片下方展示。

### 6 项指标

| 卡片 | 数据来源 |
|------|----------|
| 总字数 | `chapters` 表 `countWords(content)` 累加 |
| 已完成章节 | `chapters` 表 `status === 'done'` 计数 |
| 今日新增字数 | `version_snapshots` 今日最早/最新快照字数差 |
| 连续写作天数 | `version_snapshots` 按 `createdAt` 去重到天，倒序统计连续天数 |
| 创作进度 | 已完成章节 / 总章节，百分比 + 进度条 |
| 伏笔追踪 | `plot_arcs` 已解决 / 总数 |

### 交互

- 卡片纯展示，无点击交互
- 加载项目数据时一并计算，无额外请求
- 无数据时显示 "—"

### 涉及文件

- 修改: `src/pages/ProjectDashboard.jsx`

---

## C. 角色关系图谱

### 方案

Canvas 手绘知识图谱，零依赖简易力导向布局。

### 数据模型

新增 `character_relations` 表：

```js
character_relations: '++id, projectId, fromCharId, toCharId'
// 字段: projectId, fromCharId, toCharId, type, description
```

关系类型: 师徒、敌对、爱慕、亲子、朋友、盟友、上下级、其他

### 可视化（Canvas）

- 节点: 圆形 + 角色名
- 边: 带箭头连线 + 关系类型标签
- 力导向布局: 节点间互斥 + 边弹簧拉力，迭代 100 轮收敛
- 拖拽节点移动、滚轮缩放
- 悬停高亮该节点所有关系

### 交互

- 人物卡片上「+ 添加关系」→ 弹窗选目标角色 + 关系类型
- 图谱悬停看关系描述，右键删除关系
- 无关系角色自动排列在边缘

### 自动关系提取

人物策划对话和总策划对话中，AI 回复时自动解析角色关系：
- 在 `chatModes.js` 对应模式的 `extractData` 中增加关系识别
- AI 回复后自动提取，与现有角色信息提取同流程
- 重复关系（同 fromCharId + toCharId + type）自动去重
- 聊天消息下方展示提取到的关系供用户确认

### 涉及文件

- 新建: `src/components/RelationGraph.jsx`, `src/utils/forceLayout.js`
- 修改: `src/db/index.js`, `src/pages/ProjectDashboard.jsx`, `src/utils/chatModes.js`

---

## D. 版本历史/定时快照

### 方案

全量快照，定时 5 分钟自动保存 + 手动保存触发。

### 数据模型

新增 `version_snapshots` 表：

```js
version_snapshots: '++id, chapterId, createdAt'
// 字段: chapterId, content, wordCount, createdAt
```

### 快照逻辑

- 定时器每 5 分钟检查，内容有变化则自动创建快照
- 「保存草稿」和「定稿」时同步创建快照
- 清理: 每章最多 20 个，超 7 天自动删除

### UI

- 编辑器工具栏新增「历史版本」按钮
- 点击弹出侧边面板，时间倒序列表
- 每项: 时间戳、字数、前 50 字预览
- 点击某版本 → diff 视图（当前 vs 历史）
- 「恢复此版本」按钮 → 确认后替换编辑器内容

### Diff 实现

自写逐行对比（~50 行），绿色标记新增、红色标记删除。

### 涉及文件

- 修改: `src/db/index.js`, `src/pages/WritePage.jsx`

---

## 全局变更清单

### 新增文件
- `src/hooks/useDarkMode.js`
- `src/components/RelationGraph.jsx`
- `src/utils/forceLayout.js`

### 修改文件
- `src/styles/global.css`
- `src/components/Layout.jsx`
- `src/App.jsx`
- `src/db/index.js`
- `src/pages/ProjectDashboard.jsx`
- `src/pages/WritePage.jsx`
- `src/utils/chatModes.js`

### 数据库新增表
- `character_relations` — 角色关系
- `version_snapshots` — 章节版本快照

### 数据库版本号
- `db.version(4)` → `db.version(5)`
