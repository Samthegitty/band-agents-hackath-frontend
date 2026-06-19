import { useState, useRef, useCallback } from 'react'

const AGENT_ORDER = ['orchestrator', 'assessment', 'curator', 'studyplan']
const AGENT_LABELS = { 
  orchestrator: 'Orchestrator', 
  assessment: 'Assessment', 
  curator: 'Curator', 
  studyplan: 'Study Plan' 
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

// --- RENDERER: Shows findings as red cards, everything else as text ---
function MessageContent({ content }) {
  if (!content) return <span style={{color: '#666'}}>Empty message</span>;

  // Check if this is a scan report with findings
  const hasFindings = content.includes("[CRITICAL]") || content.includes("[HIGH]")
  const isScanComplete = content.includes("SCAN COMPLETE") && content.includes("Top findings:")
  
  if (hasFindings && isScanComplete) {
    const lines = content.split('\n');
    const findings = lines.filter(l => l.includes("[CRITICAL]") || l.includes("[HIGH]"));
    const intro = lines.filter(l => !l.includes("[CRITICAL]") && !l.includes("[HIGH]")).join('\n');

    return (
      <div style={{ 
        background: '#0f172a', 
        padding: '20px', 
        borderRadius: '12px', 
        border: '2px solid #ef4444',
        color: '#e2e8f0',
        marginTop: '8px'
      }}>
        <div style={{ 
          color: '#f87171', 
          fontWeight: 'bold', 
          marginBottom: '16px', 
          fontSize: '1.2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🚨</span> Quantum Vulnerability Scan Report
        </div>
        <div style={{ 
          fontSize: '0.95rem', 
          marginBottom: '20px', 
          whiteSpace: 'pre-wrap', 
          color: '#94a3b8',
          lineHeight: '1.6'
        }}>
          {intro.trim()}
        </div>
        
        {findings.length > 0 && (
          <>
            <div style={{ 
              color: '#f87171', 
              fontWeight: 'bold', 
              marginBottom: '12px', 
              borderTop: '2px solid #334155', 
              paddingTop: '16px',
              fontSize: '1.1rem'
            }}>
              Top Findings:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {findings.map((f, i) => (
                <div 
                  key={i} 
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    borderLeft: '4px solid #ef4444',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    color: '#fca5a5',
                    lineHeight: '1.5'
                  }}
                >
                  {f.trim()}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // For AI-generated study plan and other messages
  if (content.includes("📚 LEARNING PATH") || content.includes("🗓️ STUDY PLAN")) {
    return (
      <div style={{ 
        background: '#1e293b', 
        padding: '20px', 
        borderRadius: '12px', 
        border: '2px solid #3b82f6',
        color: '#e2e8f0',
        marginTop: '8px',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.6'
      }}>
        {content}
      </div>
    );
  }

  // Default rendering
  return <div style={{ 
    whiteSpace: 'pre-wrap', 
    lineHeight: '1.6',
    color: '#e2e8f0'
  }}>{content}</div>;
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState('')
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle') 
  const [activeStage, setActiveStage] = useState(null)
  const [completedStages, setCompletedStages] = useState(new Set())
  const wsRef = useRef(null)

  const updatePipelineFromMessage = useCallback((authorKind, isDone = false) => {
    console.log('📊 Updating pipeline:', { authorKind, isDone })
    if (!AGENT_ORDER.includes(authorKind)) return
    setActiveStage(authorKind)
    setCompletedStages((prev) => {
      const next = new Set(prev)
      const idx = AGENT_ORDER.indexOf(authorKind)
      for (let i = 0; i < idx; i++) next.add(AGENT_ORDER[i])
      if (isDone) {
        next.add(authorKind)
        // Mark all as complete
        AGENT_ORDER.forEach(stage => next.add(stage))
      }
      return next
    })
  }, [])

  const startScan = async (e) => {
    e.preventDefault()
    if (!repoUrl.trim() || status === 'starting' || status === 'running') return

    console.log('🚀 Starting scan for:', repoUrl)
    setMessages([])
    setCompletedStages(new Set())
    setActiveStage('orchestrator')
    setStatus('starting')

    try {
      const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://band-agents-hackath-production.up.railway.app').replace(/\/+$/, '');
      
      console.log('📡 Fetching from:', `${API_BASE_URL}/api/scan`)
      const resp = await fetch(`${API_BASE_URL}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: repoUrl.trim() }),
      })
      
      if (!resp.ok) {
        console.error('❌ Server error:', resp.status)
        throw new Error(`Server responded ${resp.status}`)
      }
      
      const { room_id } = await resp.json()
      console.log('✅ Room created:', room_id)

      setMessages([{ 
        id: 'local-kickoff', 
        authorKind: 'user', 
        author: 'you', 
        content: `@qs-orchestrator scan ${repoUrl.trim()}` 
      }])
      setStatus('running')

      const wsProto = API_BASE_URL.startsWith('https') ? 'wss' : 'ws'
      const wsHost = API_BASE_URL.replace(/^https?:\/\//, '')
      const wsUrl = `${wsProto}://${wsHost}/ws/${room_id}`
      
      console.log('🔌 Connecting to WebSocket:', wsUrl)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('✅ WebSocket connected')
      }

      ws.onmessage = (event) => {
        console.log('📨 Raw WebSocket message:', event.data)
        
        try {
          const msg = JSON.parse(event.data)
          console.log('📨 Parsed message:', { 
            id: msg.id, 
            author: msg.author, 
            content: msg.content?.substring(0, 100) + '...',
            is_done: msg.is_done 
          })
          
          // Safety: Ignore empty messages
          if (!msg.content || msg.content.trim() === '') {
            console.log('⚠️ Ignoring empty message')
            return 
          }

          const authorKind = classifyAuthor(msg.author)
          updatePipelineFromMessage(authorKind, msg.is_done)
          
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) {
              console.log('⚠️ Duplicate message, ignoring')
              return prev
            }
            const newMsg = { 
              id: msg.id, 
              authorKind, 
              author: msg.author, 
              content: msg.content 
            }
            console.log('✅ Added message to UI:', newMsg.author, newMsg.content.substring(0, 50))
            return [...prev, newMsg]
          })
          
          // DETECTION 1: Check for is_done flag
          if (msg.is_done) {
            console.log('🎯 DETECTED: is_done flag! Completing UI...')
            setStatus('idle')
            setCompletedStages(new Set(AGENT_ORDER))
            ws.close()
            return
          }
          
          // DETECTION 2: Check for scan complete in content
          if (msg.content.includes("SCAN COMPLETE") && msg.content.includes("Top findings:")) {
            console.log('🎯 DETECTED: Scan complete in content!')
          }
          
          // DETECTION 3: Check for pipeline complete
          if (msg.content.includes("Pipeline complete") || msg.content.includes("✅")) {
            console.log('🎯 DETECTED: Pipeline complete message!')
            setStatus('idle')
            setCompletedStages(new Set(AGENT_ORDER))
            ws.close()
          }
          
        } catch (err) {
          console.error('❌ Error parsing message:', err)
        }
      }

      ws.onclose = () => { 
        console.log('🔌 WebSocket closed')
        setStatus('idle')
        setCompletedStages(new Set(AGENT_ORDER))
      }
      
      ws.onerror = (err) => { 
        console.error('❌ WebSocket error:', err)
        setStatus('error')
      }
      
    } catch (err) {
      console.error('❌ Scan error:', err)
      setStatus('error')
    }
  }

  return (
    <div className="app" style={{
      minHeight: '100vh',
      background: '#0a0e27',
      color: '#e2e8f0',
      padding: '40px 20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <header style={{ marginBottom: '40px' }}>
          <p style={{ 
            color: '#64ffda', 
            fontSize: '0.9rem', 
            marginBottom: '8px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase'
          }}>
            VyalaArchon · Band of Agents Hackathon 2026
          </p>
          <h1 style={{ 
            fontSize: '3rem', 
            margin: '0 0 16px 0',
            fontWeight: '800',
            letterSpacing: '-0.02em'
          }}>
            Find what 2030 will <em style={{ color: '#64ffda', fontStyle: 'italic' }}>break</em>.
          </h1>
          <p style={{ 
            color: '#8892b0', 
            fontSize: '1.1rem', 
            lineHeight: '1.6',
            maxWidth: '700px'
          }}>
            Drop in a public GitHub repo. Three Band agents will scan it for quantum-vulnerable cryptography, map every finding to its NIST replacement, and build a grounded learning path — live, in this feed.
          </p>
        </header>

        <form onSubmit={startScan} style={{ marginBottom: '30px' }}>
          <div style={{ 
            display: 'flex', 
            gap: '12px',
            marginBottom: '8px'
          }}>
            <input 
              type="text" 
              placeholder="https://github.com/jpadilla/pyjwt" 
              value={repoUrl} 
              onChange={(e) => setRepoUrl(e.target.value)} 
              disabled={status === 'starting' || status === 'running'}
              style={{
                flex: 1,
                padding: '16px 20px',
                background: '#112240',
                border: '2px solid #233554',
                borderRadius: '8px',
                color: '#e2e8f0',
                fontSize: '1rem',
                fontFamily: 'monospace',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
            />
            <button 
              type="submit" 
              disabled={status === 'starting' || status === 'running'}
              style={{
                padding: '16px 32px',
                background: status === 'running' ? '#64ffda' : '#233554',
                color: status === 'running' ? '#0a0e27' : '#64ffda',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: status === 'running' ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                minWidth: '140px'
              }}
            >
              {status === 'running' ? 'Scanning…' : 'Run scan'}
            </button>
          </div>
          <p style={{ color: '#8892b0', fontSize: '0.9rem' }}>
            Try <button 
              type="button" 
              onClick={() => setRepoUrl('https://github.com/jpadilla/pyjwt')}
              style={{
                background: 'none',
                border: 'none',
                color: '#64ffda',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '0.9rem'
              }}
            >jpadilla/pyjwt</button>
          </p>
        </form>

        {status !== 'idle' && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            marginBottom: '40px',
            padding: '20px',
            background: '#112240',
            borderRadius: '12px'
          }}>
            {AGENT_ORDER.map((stage, i) => (
              <span key={stage} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  padding: '10px 20px',
                  background: completedStages.has(stage) ? '#64ffda' : 
                             activeStage === stage ? '#233554' : '#112240',
                  color: completedStages.has(stage) ? '#0a0e27' : '#8892b0',
                  borderRadius: '20px',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  border: completedStages.has(stage) ? '2px solid #64ffda' : 
                         activeStage === stage ? '2px solid #233554' : '2px solid #112240',
                  transition: 'all 0.3s'
                }}>
                  {AGENT_LABELS[stage]}
                </div>
                {i < AGENT_ORDER.length - 1 && (
                  <span style={{ 
                    width: '40px', 
                    height: '2px', 
                    background: completedStages.has(stage) ? '#64ffda' : '#233554',
                    marginLeft: '8px'
                  }} />
                )}
              </span>
            ))}
          </div>
        )}

        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px' 
        }}>
          {messages.length === 0 && status === 'idle' && (
            <div style={{ 
              padding: '60px 40px', 
              textAlign: 'center',
              background: '#112240',
              borderRadius: '12px',
              color: '#8892b0'
            }}>
              No scan running yet. Paste a repo URL above to start.
            </div>
          )}
          
          {status === 'error' && (
            <div style={{ 
              padding: '30px', 
              background: 'rgba(239, 68, 68, 0.1)',
              border: '2px solid #ef4444',
              borderRadius: '12px',
              color: '#f87171'
            }}>
              Something went wrong. Check the browser console for details.
            </div>
          )}
          
          {messages.map((m) => (
            <div 
              key={m.id} 
              style={{
                padding: '24px',
                background: '#112240',
                borderRadius: '12px',
                borderLeft: m.authorKind === 'user' ? '4px solid #64ffda' : 
                           m.authorKind === 'assessment' ? '4px solid #ef4444' :
                           m.authorKind === 'curator' ? '4px solid #3b82f6' :
                           m.authorKind === 'studyplan' ? '4px solid #10b981' :
                           '4px solid #8892b0',
                transition: 'all 0.3s'
              }}
            >
              <div style={{ 
                color: m.authorKind === 'user' ? '#64ffda' : 
                      m.authorKind === 'assessment' ? '#ef4444' :
                      m.authorKind === 'curator' ? '#3b82f6' :
                      m.authorKind === 'studyplan' ? '#10b981' :
                      '#8892b0',
                fontSize: '0.85rem',
                fontWeight: '700',
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {authorDisplayName(m.author)}
              </div>
              <MessageContent content={m.content} />
            </div>
          ))}
        </div>

        <footer style={{ 
          marginTop: '60px', 
          paddingTop: '30px',
          borderTop: '2px solid #233554',
          textAlign: 'center',
          color: '#8892b0',
          fontSize: '0.9rem'
        }}>
          Built with Band + AI/ML API (NVIDIA Nemotron 3 Ultra) · 
          <a href="https://band.ai" target="_blank" rel="noreferrer" style={{
            color: '#64ffda',
            marginLeft: '8px',
            textDecoration: 'none'
          }}>band.ai</a>
        </footer>
      </div>
    </div>
  )
}