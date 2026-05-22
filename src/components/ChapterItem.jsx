import { countWords } from '../utils/wordCount'

const STATUS_MAP = {
  planned: { label: '待写', cls: 'status-planned' },
  draft: { label: '草稿', cls: 'status-draft' },
  done: { label: '完成', cls: 'status-done' },
}

export default function ChapterItem({ chapter, onWrite, onClick }) {
  const status = STATUS_MAP[chapter.status] || STATUS_MAP.planned

  return (
    <div className="chapter-item" onClick={() => onClick?.(chapter)}>
      <div className="chapter-number">第{chapter.number}章</div>
      <div className="chapter-info">
        <div className="chapter-title">{chapter.title || '未命名'}</div>
        {chapter.summary && <div className="chapter-summary">{chapter.summary}</div>}
        {chapter.content && (
          <div className="chapter-word-count">
            约 {countWords(chapter.content)} 字
          </div>
        )}
      </div>
      <div className="chapter-actions">
        <span className={`chapter-status ${status.cls}`}>{status.label}</span>
        {onWrite && chapter.status !== 'done' && (
          <button
            className="btn btn-primary btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onWrite(chapter)
            }}
          >
            去写作
          </button>
        )}
        {chapter.status === 'done' && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onClick?.(chapter)
            }}
          >
            查看
          </button>
        )}
      </div>
    </div>
  )
}
