/**
 * Reusable 4-stage chapter generation pipeline.
 * Shared by single-chapter and batch generation modes.
 */
import { streamChat } from '../api/deepseek'
import { saveChapterSummary, savePlotArc, saveChapter } from '../db'
import { countWords } from './wordCount'
import {
  buildDetailedOutlinePrompt,
  buildDraftPrompt,
  buildConsistencyReviewPrompt,
  buildPolishPrompt,
  buildChapterSummaryPrompt,
  parseChapterSummaryJSON,
} from './summaryExtractor'

function buildFullChain(chapters, summaryChain) {
  return chapters.map((c) => {
    const found = summaryChain.find((s) => s.chapter?.id === c.id || s.chapterId === c.id)
    return { chapter: c, summary: found?.summary || null }
  })
}

/**
 * Run the 4-stage pipeline for one chapter.
 *
 * @param {Object} params
 * @param {Object} params.project
 * @param {Array}  params.characters
 * @param {Array}  params.chapters
 * @param {Array}  params.summaryChain      - from getAllChapterSummaries()
 * @param {Object} params.targetChapter     - { id, number, title, summary }
 * @param {Array}  params.plotArcs          - from getOpenPlotArcs()
 * @param {Object} params.wordCount         - { min, target, max }
 * @param {string} params.apiKey
 * @param {(stage: string) => void}  params.onStageChange
 * @param {(stage: string, text: string) => void} params.onOutput
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{outline: string, draft: string, review: string, final: string}>}
 */
export async function runChapterPipeline({
  project,
  characters,
  chapters,
  summaryChain,
  targetChapter,
  plotArcs,
  wordCount,
  apiKey,
  onStageChange,
  onOutput,
  signal,
}) {
  const fullChain = buildFullChain(chapters, summaryChain)
  const totalWordCount = chapters.reduce((sum, c) => sum + countWords(c.content || ''), 0)
  const checkAbort = () => {
    if (signal?.aborted) throw new Error('已中止')
  }

  // --- Stage 1: Detailed Outline ---
  onStageChange('outline')
  const outlinePrompt = buildDetailedOutlinePrompt(project, characters, fullChain, targetChapter, totalWordCount)
  let outlineText = ''
  checkAbort()
  await streamChat(
    [
      { role: 'system', content: '你是一位专业小说策划，用中文回复。' },
      { role: 'user', content: outlinePrompt },
    ],
    {
      apiKey,
      temperature: 0.7,
      maxTokens: 1024,
      signal,
      onChunk(chunk) {
        outlineText += chunk
        onOutput('outline', outlineText)
      },
      onDone() {},
      onError(err) {
        throw new Error('大纲生成失败: ' + err)
      },
    }
  )
  checkAbort()

  // --- Stage 2: Draft ---
  onStageChange('draft')
  const draftPrompt = buildDraftPrompt(project, characters, fullChain, targetChapter, outlineText, wordCount, totalWordCount)
  let draftText = ''
  checkAbort()
  await streamChat(
    [
      { role: 'system', content: '你是一位专业小说作家，用中文回复。' },
      { role: 'user', content: draftPrompt },
    ],
    {
      apiKey,
      temperature: 0.85,
      maxTokens: 8192,
      signal,
      onChunk(chunk) {
        draftText += chunk
        onOutput('draft', draftText)
      },
      onDone() {},
      onError(err) {
        throw new Error('草稿生成失败: ' + err)
      },
    }
  )
  checkAbort()

  // --- Stage 3: Consistency Review ---
  onStageChange('review')
  const reviewPrompt = buildConsistencyReviewPrompt(project, characters, fullChain, targetChapter, draftText, plotArcs, totalWordCount)
  let reviewText = ''
  checkAbort()
  try {
    await streamChat(
      [
        { role: 'system', content: '你是一位严谨的小说审校编辑，用中文回复。' },
        { role: 'user', content: reviewPrompt },
      ],
      {
        apiKey,
        temperature: 0.3,
        maxTokens: 2048,
        signal,
        onChunk(chunk) {
          reviewText += chunk
          onOutput('review', reviewText)
        },
        onDone() {},
        onError() {
          reviewText = '审校服务暂不可用，自动通过。'
          onOutput('review', reviewText)
        },
      }
    )
  } catch {
    reviewText = '审校服务暂不可用，自动通过。'
    onOutput('review', reviewText)
  }
  checkAbort()

  // --- Stage 4: Polish ---
  onStageChange('polish')
  const polishPrompt = buildPolishPrompt(draftText, reviewText, wordCount)
  let finalText = ''
  checkAbort()
  try {
    await streamChat(
      [
        { role: 'system', content: '你是一位专业小说润色编辑，用中文回复。' },
        { role: 'user', content: polishPrompt },
      ],
      {
        apiKey,
        temperature: 0.6,
        maxTokens: 8192,
        signal,
        onChunk(chunk) {
          finalText += chunk
          onOutput('final', finalText)
        },
        onDone() {},
        onError() {
          finalText = draftText
          onOutput('final', finalText)
        },
      }
    )
  } catch {
    finalText = draftText
    onOutput('final', finalText)
  }

  return { outline: outlineText, draft: draftText, review: reviewText, final: finalText }
}

/**
 * Extract and save structured chapter summary (non-blocking, fire-and-forget).
 * Mirrors the summary extraction logic from handleSave.
 *
 * @param {Object} chapter  - { id, number, title }
 * @param {string} content  - chapter full text
 * @param {Object} project  - project record
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
export async function extractAndSaveSummary(chapter, content, project, apiKey) {
  if (!content) return

  try {
    const summaryPrompt = buildChapterSummaryPrompt(project, chapter, content)
    const summaryMessages = [
      { role: 'system', content: '你是小说分析助手，始终返回严格 JSON，不要加额外文字。' },
      { role: 'user', content: summaryPrompt },
    ]

    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
      await saveChapterSummary(chapter.id, parsed)
      // Always overwrite the flag on the chapter record
      await saveChapter({ id: chapter.id, isKeyChapter: parsed.isKeyChapter || false, keyReason: parsed.isKeyChapter ? (parsed.keyReason || '') : '' })
      if (parsed.foreshadowing && parsed.foreshadowing !== '无') {
        await savePlotArc({
          projectId: Number(project.id),
          type: 'foreshadowing',
          description: `第${chapter.number}章：${parsed.foreshadowing}`,
          status: 'open',
          relatedChapter: chapter.number,
        })
      }
    }
  } catch {
    // Summary extraction is non-blocking
  }
}

/**
 * Re-analyze all written chapters to detect key chapters and update summaries.
 * Useful for retroactively marking existing chapters after the key-chapter feature is added.
 *
 * @param {Array}   chapters - all chapter records
 * @param {Object}  project  - project record
 * @param {string}  apiKey
 * @param {(current: number, total: number, title: string) => void} onProgress
 * @returns {Promise<{analyzed: number, keyChapters: number, errors: number}>}
 */
export async function reanalyzeAllChapters(chapters, project, apiKey, onProgress) {
  const written = chapters.filter((c) => c.content)
  let analyzed = 0
  let keyChapters = 0
  let errors = 0

  for (const ch of written) {
    try {
      onProgress(analyzed + 1, written.length, ch.title || `第${ch.number}章`)
      const summaryPrompt = buildChapterSummaryPrompt(project, ch, ch.content)
      const summaryMessages = [
        { role: 'system', content: '你是小说分析助手，始终返回严格 JSON，不要加额外文字。' },
        { role: 'user', content: summaryPrompt },
      ]

      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
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
        await saveChapterSummary(ch.id, parsed)
        // Always overwrite the flag — clears previously-marked chapters that no longer qualify
        await saveChapter({ id: ch.id, isKeyChapter: parsed.isKeyChapter || false, keyReason: parsed.isKeyChapter ? (parsed.keyReason || '') : '' })
        if (parsed.isKeyChapter) keyChapters++
        analyzed++
      }
    } catch {
      errors++
    }
  }

  return { analyzed, keyChapters, errors }
}
