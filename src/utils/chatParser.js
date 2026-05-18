/**
 * Parse AI message content to extract optional structured parts.
 * Returns { text: string, options: string[] | null }
 *
 * AI messages may contain [OPTIONS]...[/OPTIONS] blocks.
 * Each line inside is one option (stripped of leading bullet/number).
 */

const OPTIONS_RE = /\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/

export function parseAIMessage(content) {
  const options = []
  let text = content

  const match = OPTIONS_RE.exec(content)
  if (match) {
    text = content.replace(OPTIONS_RE, '').trim()
    const raw = match[1].trim()
    // Split by newline, filter empty, strip leading markers like "A. " or "- "
    const items = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[A-Fa-f0-9]+[.、)]\s*/, '').replace(/^[-*]\s*/, ''))
    options.push(...items)
  }

  return { text, options: options.length > 0 ? options : null }
}

/**
 * Check if content contains an options block.
 */
export function hasOptions(content) {
  return /\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/.test(content)
}
