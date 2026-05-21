import { useState, useEffect } from 'react'
import { getSetting, setSetting } from '../db'

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [temperature, setTemperature] = useState('0.8')
  const [maxTokens, setMaxTokens] = useState('4096')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    (async () => {
      const key = await getSetting('apiKey')
      const temp = await getSetting('temperature')
      const tokens = await getSetting('maxTokens')
      if (key) setApiKey(key)
      if (temp) setTemperature(temp)
      if (tokens) setMaxTokens(tokens)
    })()
  }, [])

  const handleSave = async () => {
    await setSetting('apiKey', apiKey)
    await setSetting('temperature', temperature)
    await setSetting('maxTokens', maxTokens)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h1 className="page-title">设置</h1>
      <div className="card settings-card">
        <div className="form-group">
          <label className="form-label">DeepSeek API Key</label>
          <input
            className="form-input"
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p style={{ fontSize: 12, color: '#9A9A9A', marginTop: 6 }}>
            使用 deepseek-v4-flash 模型。API Key 仅保存在浏览器本地。
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">
            温度 ({temperature}) — 越高越有创意
          </label>
          <input
            className="form-input"
            type="range"
            min="0.1"
            max="1.5"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">最大生成长度 (tokens)</label>
          <select
            className="form-select"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          >
            <option value="2048">2048</option>
            <option value="4096">4096</option>
            <option value="8192">8192</option>
            <option value="16384">16384</option>
          </select>
        </div>

        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '已保存' : '保存设置'}
        </button>
      </div>
    </div>
  )
}
