import { useEffect, useState } from 'react'

export default function App() {
  const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  const [key, setKey] = useState(sessionStorage.getItem('bk-dashboard-key') || '')
  const [qr, setQr] = useState(null)
  const [code, setCode] = useState(null)
  const [phone, setPhone] = useState('')
  const [ranks, setRanks] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-dashboard-key': key, ...(options.headers || {}) }
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
    return data
  }

  useEffect(() => {
    if (!key) return
    sessionStorage.setItem('bk-dashboard-key', key)
    let active = true
    const refresh = async () => {
      try {
        const [q, p, rk, st] = await Promise.all([
          api('/api/qr'), api('/api/pair'), api('/api/ranks'), api('/api/status')
        ])
        if (active) { setQr(q.qr); setCode(p.code); setRanks(rk); setStatus(st); setError('') }
      } catch (e) { if (active) setError(e.message) }
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [key])

  async function getPair() {
    setBusy(true); setError(''); setCode(null)
    try {
      const data = await api('/api/pair', { method: 'POST', body: JSON.stringify({ phone }) })
      setCode(data.code)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  return <main>
    <header><div className="crown">♛</div><h1>BRIGHT KINGDOM</h1><p>WhatsApp group bot dashboard</p></header>
    <section className="panel setup">
      <label htmlFor="key">Dashboard key</label>
      <input id="key" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Enter DASHBOARD_KEY" />
      <small>Use the same secret you set in the backend environment. Keep it private.</small>
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="cards">
      <article className="panel"><h2>1 · Scan QR</h2>{qr ? <img className="qr" src={qr} alt="WhatsApp linking QR code" /> : <p className="waiting">Waiting for QR…</p>}<p className="hint">WhatsApp → Linked devices → Link a device</p></article>
      <article className="panel"><h2>2 · Pair by phone</h2><label htmlFor="phone">Phone number with country code</label><input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="2348012345678" inputMode="numeric"/><button disabled={!key || !phone || busy} onClick={getPair}>{busy ? 'Generating…' : 'Get pairing code'}</button>{code && <div className="pair-code">{code}</div>}<p className="hint">In WhatsApp, choose Link with phone number instead.</p></article>
    </section>
    <section className="panel"><h2>Connection status</h2><p>{status?.connected ? '🟢 Connected' : '🟡 Not connected yet'}</p></section>
    <section className="panel"><h2>Live ranks</h2><pre>{ranks ? JSON.stringify(ranks, null, 2) : 'Enter your dashboard key to load ranks.'}</pre></section>
    <footer>Commands: .menu · .ranks · .crown · .exile · .vap · .d · .p · .paralyse · .mute</footer>
  </main>
}
