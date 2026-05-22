/**
 * Parse AI message content.
 * Strips structured tags from display text and extracts clickable options.
 */

const EXACT_TAGS = [
  '[CHARACTER]', '[/CHARACTER]',
  '[SYNOPSIS]', '[/SYNOPSIS]',
  '[CHAPTERS]', '[/CHAPTERS]',
  '[REWRITE]', '[/REWRITE]',
]

function stripStructTags(text) {
  let out = text
  for (const tag of EXACT_TAGS) {
    out = out.split(tag).join('')
  }
  out = out.replace(/\[PHASE:\w+\]/g, '')
  out = out.replace(/\[SETTING:[^\]]+\]/g, '')
  return out
}

export function parseAIMessage(content) {
  const startTag = '[OPTIONS]'
  const endTag = '[/OPTIONS]'

  const startIdx = content.indexOf(startTag)
  const endIdx = content.indexOf(endTag)

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No options block — still strip other struct tags for clean display
    return { text: stripStructTags(content), options: null }
  }

  // Build text by removing the [OPTIONS]...[/OPTIONS] block
  const before = content.slice(0, startIdx)
  const after = content.slice(endIdx + endTag.length)
  let text = (before + after).trim()

  // Strip remaining struct tags
  text = stripStructTags(text)

  // Extract option lines
  const raw = content.slice(startIdx + startTag.length, endIdx).trim()
  const items = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^\d+[.、)]\s*/, '')   // "1. " "2、" "3) "
        .replace(/^[-*•]\s*/, '')       // "- " "* " "• "
    )

  return { text, options: items.length > 0 ? items : null }
}

export function hasOptions(content) {
  const si = content.indexOf('[OPTIONS]')
  const ei = content.indexOf('[/OPTIONS]')
  return si !== -1 && ei !== -1 && ei > si
}
