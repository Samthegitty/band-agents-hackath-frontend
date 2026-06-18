import { useState, useRef, useCallback } from 'react'

const AGENT_ORDER = ['orchestrator', 'assessment', 'curator', 'studyplan']

const AGENT_LABELS = {
  orchestrator: 'Orchestrator',
  assessment: 'Assessment',
  curator: 'Curator',
  studyplan: 'Study Plan',
}

function classifyAuthor(handle) {
  const h = (handle || '').toLowerCase()
  if (h.includes('orchestrator')) return 'orchestrator'
  if (h.includes('assessment')) return 'assessment'
  if (h.includes('curator')) return 'curator'
  if (h.includes('studyplan')) return 'studyplan'
  return 'user'
}

function authorDisplayName(handle) {
  const kind = classifyAuthor(handle)
  if (kind === 'user') return handle || 'you'
  return `@${handle}`
}

// --- NEW: Component to beautifully render the "Top findings:" section ---
function MessageContent({ content }) {
  if (!content) return null;

  if (content.includes("Top findings:")) {
    const parts = content.split("Top findings:");
    const intro = parts[0];
    const findingsText = parts[1];
    
    // Extract individual findings lines
    const findings = findingsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('[CRITICAL]') || line.startsWith('[HIGH]'));

    return (
      <div>
        <div style={{ whiteSpace: 'pre-wrap', marginBottom: '12px', color: '#e2e8f0' }}>
          {intro.trim()}
        </div>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#f87171' }}>
          Top findings:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {findings.map((f, i) => (
            <div 
              key={i} 
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                color: '#fca5a5',
                lineHeight: '1.4'
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default rendering for normal messages
  return <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>;
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState('')
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle') 
  const [activeStage, setActiveStage] = useState(null)
  const [completedStages, setCompletedStages] = useState(new Set())
  const wsRef = useRef(null)

  const updatePipelineFromMessage = useCallback((authorKind, isDone = false) => {
    if (!AGENT_ORDER.includes(authorKind)) return
    setActiveStage(authorKind)
    setCompletedStages((prev) => {
      const next = new Set(prev)
      const idx = AGENT_ORDER.indexOf(authorKind)
      for (let i = 0; i < idx; i++) next.add(AGENT_ORDER[i])
      if (isDone) next.add(authorKind)
      return next
    })
  }, [])

  const startScan = async (e) => {
    e.preventDefault()
    if (!repoUrl.trim() || status === 'starting' || status === 'running') return

    setMessages([])
    setCompletedStages(new Set())
    setActiveStage('orchestrator')
    setStatus('starting')

    try {
      // NOTE: Make sure API_BASE_URL points to your Railway backend!
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://band-agents-hackath-production.up.railway.app/';
      
      const resp = await fetch(`${API_BASE_URL}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: repoUrl.trim() }),
      })
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`)
      const { room_id } = await resp.json()

      setMessages([{
        id: 'local-kickoff',
        authorKind: 'user',
        author: 'you',
        content: `@qs-orchestrator scan ${repoUrl.trim()}`,
      }])
      setStatus('running')

      const wsProto = API_BASE_URL.startsWith('https') ? 'wss' : 'ws'
      const wsHost = API_BASE_URL.replace(/^https?:\/\//, '')
      const ws = new WebSocket(`${wsProto}://${wsHost}/ws/${room_id}`)
      wsRef.current = ws

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        const authorKind = classifyAuthor(msg.author)
        
        updatePipelineFromMessage(authorKind, msg.is_done)
        
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, {
            id: msg.id,
            authorKind,
            author: msg.author,
            content: msg.content,
          }]
        })
        
        if (msg.is_done) {
          setStatus('idle')
          setCompletedStages(new Set(AGENT_ORDER))
          ws.close()
        }
      }

      ws.onclose = () => {
        setStatus('idle')
        setCompletedStages(new Set(AGENT_ORDER))
      }

      ws.onerror = () => setStatus('error')
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <p className="header__eyebrow">VyalaArchon · Band of Agents Hackathon 2026</p>
        <h1 className="header__title">
          Find what 2030 will <em>break</em>.
        </h1>
        <p className="header__subtitle">
          Drop in a public GitHub repo. Three Band agents will scan it for
          quantum-vulnerable cryptography, map every finding to its NIST
          replacement, and build a grounded learning path — live, in this feed.
        </p>
      </header>

      <form className="scan-form" onSubmit={startScan}>
        <input
          className="scan-form__input"
          type="text"
          placeholder="https://github.com/jpadilla/pyjwt"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          disabled={status === 'starting' || status === 'running'}
        />
        <button
          className="scan-form__button"
          type="submit"
          disabled={status === 'starting' || status === 'running'}
        >
          {status === 'running' ? 'Scanning…' : 'Run scan'}
        </button>
      </form>
      <p className="scan-form__hint">
        Try{' '}
        <button type="button" onClick={() => setRepoUrl('https://github.com/jpadilla/pyjwt')}>
          jpadilla/pyjwt
        </button>
          ,{' '}
      </p>

      {status !== 'idle' && (
        <div className="pipeline-strip">
          {AGENT_ORDER.map((stage, i) => (
            <span key={stage} style={{ display: 'flex', alignItems: 'center' }}>
              <span
                className={
                  'pipeline-strip__node' +
                  (activeStage === stage ? ' is-active' : '') +
                  (completedStages.has(stage) ? ' is-done' : '')
                }
              >
                <span className="pipeline-strip__dot" />
                {AGENT_LABELS[stage]}
              </span>
              {i < AGENT_ORDER.length - 1 && <span className="pipeline-strip__connector" />}
            </span>
          ))}
        </div>
      )}

      <div className="feed">
        {messages.length === 0 && status === 'idle' && (
          <div className="feed__empty">
            No scan running yet. Paste a repo URL above to start.
          </div>
        )}
        {status === 'error' && (
          <div className="feed__empty">
            Something went wrong reaching the agent pipeline. Check that the
            backend is running and try again.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`message message--${m.authorKind}`}>
            <span className="message__rail" />
            <div className="message__body">
              <div className="message__author">{authorDisplayName(m.author)}</div>
              {/* --- UPDATED: Use the new MessageContent component here --- */}
              <div className="message__content">
                <MessageContent content={m.content} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <footer className="footer">
        <span>Built with Band + AI/ML API (NVIDIA Nemotron 3 Ultra)</span>
        <a href="https://band.ai" target="_blank" rel="noreferrer">band.ai</a>
      </footer>
    </div>
  )
}