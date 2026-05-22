/**
 * Count Chinese characters in text.
 * CJK characters count as 1 word each; ASCII/other count as ~0.5.
 */
export function countWords(content) {
  if (!content) return 0
  let cjk = 0
  let other = 0
  for (const ch of content) {
    const code = ch.charCodeAt(0)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk++
    } else if (ch.trim()) {
      other++
    }
  }
  return cjk + Math.round(other / 2)
}
