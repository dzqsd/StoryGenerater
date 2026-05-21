const API_BASE = 'https://api.deepseek.com/v1'

export async function streamChat(messages, { apiKey, temperature = 0.8, maxTokens = 4096, onChunk, onDone, onError, signal }) {
  const controller = signal ? null : new AbortController()
  const effectiveSignal = signal || controller.signal

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: effectiveSignal,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `API 请求失败 (${response.status})`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          const content = json.choices?.[0]?.delta?.content
          if (content) onChunk?.(content)
        } catch {
          // skip malformed JSON chunks
        }
      }
    }

    onDone?.()
  } catch (err) {
    if (err.name === 'AbortError') return
    onError?.(err.message)
  }

  return controller || { abort: () => {} }
}
