import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from 'react-oidc-context';
import './App.css';

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

function App() {
  const auth = useAuth();

  if (auth.isLoading) return <div className="loading">Loading…</div>;
  if (auth.error) return <div className="loading">Auth error: {auth.error.message}</div>;
  if (!auth.isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Everest</h1>
          <p>Architecture specification authoring</p>
          <button className="btn-primary" onClick={() => auth.signinRedirect()}>Sign in</button>
        </div>
      </div>
    );
  }

  return <Main auth={auth} />;
}

function Main({ auth }) {
  const api = useCallback(async (path, method = 'GET', body = null) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.user?.access_token}`,
        ...(method !== 'GET' && method !== 'DELETE' ? {} : {}),
      },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }, [auth.user?.access_token]);

  const [ecosystems, setEcosystems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showNewEcoModal, setShowNewEcoModal] = useState(false);

  useEffect(() => {
    api('/api/user/profile').then(p => setHasApiKey(p.hasApiKey)).catch(() => {});
    api('/api/ecosystems').then(setEcosystems).catch(() => {});
  }, [api]);

  const refreshEcosystems = () => api('/api/ecosystems').then(setEcosystems).catch(() => {});

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">Everest</span>
        <div className="topbar-right">
          {!hasApiKey && (
            <button className="btn-secondary warn" onClick={() => setShowApiKeyModal(true)}>
              ⚠ Set API key
            </button>
          )}
          <span className="user-name">{auth.user?.profile?.name || auth.user?.profile?.preferred_username}</span>
          <button className="btn-secondary" onClick={() => auth.signoutRedirect()}>Sign out</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>Ecosystems</span>
            <button className="btn-primary small" onClick={() => setShowNewEcoModal(true)}>+ New</button>
          </div>
          <ul className="eco-list">
            {ecosystems.map(e => (
              <li
                key={e.name}
                className={selected === e.name ? 'active' : ''}
                onClick={() => setSelected(e.name)}
              >
                <strong>{e.name}</strong>
                {e.description && <span className="eco-desc">{e.description}</span>}
              </li>
            ))}
            {ecosystems.length === 0 && <li className="empty">No ecosystems yet</li>}
          </ul>
        </aside>

        <main className="main-area">
          {selected
            ? <EcosystemView name={selected} api={api} />
            : <div className="empty-state">Select or create an ecosystem to get started.</div>
          }
        </main>
      </div>

      {showApiKeyModal && (
        <ApiKeyModal
          api={api}
          onClose={() => { setShowApiKeyModal(false); setHasApiKey(true); }}
        />
      )}

      {showNewEcoModal && (
        <NewEcosystemModal
          api={api}
          onClose={() => setShowNewEcoModal(false)}
          onCreated={(name) => { refreshEcosystems(); setSelected(name); setShowNewEcoModal(false); }}
        />
      )}
    </div>
  );
}

// ─── Ecosystem view ────────────────────────────────────────────────────────────

const TABS = ['Chat', 'Files', 'Effective', 'Rules', 'Topology', 'History', 'Versions'];

function EcosystemView({ name, api }) {
  const [tab, setTab] = useState('Chat');
  const [messages, setMessages] = useState([]);
  const [violations, setViolations] = useState([]);

  useEffect(() => {
    setMessages([]);
    setViolations([]);
    api(`/api/ecosystems/${name}/violations`).then(setViolations).catch(() => {});
  }, [name]);

  const onCommit = useCallback(() => {
    api(`/api/ecosystems/${name}/violations`).then(setViolations).catch(() => {});
  }, [name, api]);

  return (
    <div className="eco-view">
      <div className="eco-header">
        <h2>{name}</h2>
        <div className="violation-badge">
          {violations.filter(v => v.severity === 'error').length > 0 && (
            <span className="badge error">{violations.filter(v => v.severity === 'error').length} errors</span>
          )}
          {violations.filter(v => v.severity === 'warning').length > 0 && (
            <span className="badge warning">{violations.filter(v => v.severity === 'warning').length} warnings</span>
          )}
          {violations.length === 0 && <span className="badge ok">✓ Clean</span>}
        </div>
      </div>

      <div className="split">
        <div className="chat-panel">
          <ChatPanel name={name} api={api} messages={messages} setMessages={setMessages} onCommit={onCommit} violations={violations} />
        </div>
        <div className="right-panel">
          <div className="tabs">
            {TABS.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <div className="tab-body">
            {tab === 'Files'     && <FilesTab name={name} api={api} />}
            {tab === 'Effective' && <EffectiveTab name={name} api={api} />}
            {tab === 'Rules'     && <RulesTab violations={violations} />}
            {tab === 'Topology'  && <TopologyTab name={name} api={api} />}
            {tab === 'History'   && <HistoryTab name={name} api={api} />}
            {tab === 'Versions'  && <VersionsTab name={name} api={api} onPublished={onCommit} />}
            {tab === 'Chat'      && null /* chat is on left */}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────

function ChatPanel({ name, api, messages, setMessages, onCommit, violations }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setErrors([]);

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await api(`/api/ecosystems/${name}/messages`, 'POST', { messages: newMessages });
      const assistantMsg = { role: 'assistant', content: res.content };
      if (res.commit) assistantMsg.commit = res.commit;
      setMessages(prev => [...prev, assistantMsg]);
      if (res.errors?.length) setErrors(res.errors);
      if (res.commit) onCommit();
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); };

  return (
    <div className="chat">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Describe the system you want to build. Everest will help you design it using the Everest architecture language.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="msg-role">{m.role === 'user' ? 'You' : 'Everest'}</div>
            <div className="msg-content" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            {m.commit && (
              <div className="commit-chip">
                <span className="sha">{m.commit.sha.slice(0, 7)}</span>
                <span className="summary">{m.commit.summary}</span>
                <span className="files">{m.commit.files?.length} file(s)</span>
              </div>
            )}
          </div>
        ))}
        {loading && <div className="msg assistant"><div className="msg-role">Everest</div><div className="typing">…</div></div>}
        {errors.map((e, i) => <div key={i} className="msg-error">{e}</div>)}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Describe your architecture… (Ctrl+Enter to send)"
          rows={3}
        />
        <button className="btn-primary send" onClick={send} disabled={loading || !input.trim()}>Send</button>
      </div>
    </div>
  );
}

// ─── Files tab ────────────────────────────────────────────────────────────────

function FilesTab({ name, api }) {
  const [files, setFiles] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api(`/api/ecosystems/${name}/files`)
      .then(f => { setFiles(f); setSelected(Object.keys(f)[0] || null); })
      .catch(() => {});
  }, [name]);

  if (!files) return <div className="loading-panel">Loading…</div>;

  return (
    <div className="files-panel">
      <div className="file-tree">
        {Object.keys(files).map(p => (
          <div key={p} className={`file-entry ${selected === p ? 'active' : ''}`} onClick={() => setSelected(p)}>
            {p}
          </div>
        ))}
      </div>
      <div className="file-content">
        {selected && <pre>{files[selected]}</pre>}
      </div>
    </div>
  );
}

// ─── Effective tab ────────────────────────────────────────────────────────────

function EffectiveTab({ name, api }) {
  const [data, setData] = useState(null);
  const [selectedSvc, setSelectedSvc] = useState(null);
  const [profile, setProfile] = useState('');
  const [profiles, setProfiles] = useState([]);

  useEffect(() => {
    api(`/api/ecosystems/${name}/files`)
      .then(files => {
        const YAML = require('js-yaml'); // loaded from CDN in prod, inline for now
        // Extract profiles from ecosystem.yaml
        try {
          const eco = JSON.parse('{}'); // simplification: just fetch effective
        } catch (_) {}
      }).catch(() => {});

    const url = `/api/ecosystems/${name}/effective${profile ? `?profile=${profile}` : ''}`;
    api(url).then(d => {
      setData(d);
      if (!selectedSvc && d.services) setSelectedSvc(Object.keys(d.services)[0]);
    }).catch(() => {});
  }, [name, profile]);

  if (!data) return <div className="loading-panel">Loading…</div>;

  const svcNames = Object.keys(data.services || {});

  return (
    <div className="effective-panel">
      <div className="effective-controls">
        <select value={selectedSvc || ''} onChange={e => setSelectedSvc(e.target.value)}>
          {svcNames.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={profile} onChange={e => setProfile(e.target.value)}>
          <option value="">No profile</option>
          <option value="dev">dev</option>
          <option value="prod">prod</option>
        </select>
      </div>
      {selectedSvc && (
        <EffectiveService name={name} api={api} service={selectedSvc} profile={profile} />
      )}
    </div>
  );
}

function EffectiveService({ name, api, service, profile }) {
  const [yaml, setYaml] = useState('');

  useEffect(() => {
    const url = `/api/ecosystems/${name}/effective/${service}${profile ? `?profile=${profile}` : ''}`;
    fetch(`${BASE}${url}`, {
      headers: { Accept: 'text/plain', Authorization: `Bearer ${sessionStorage.getItem('_everest_token')}` }
    }).then(r => r.text()).then(setYaml).catch(() => {
      // Fallback: fetch JSON and stringify
      api(url).then(d => setYaml(JSON.stringify(d, null, 2))).catch(() => setYaml('Error loading'));
    });
  }, [name, service, profile]);

  return (
    <pre className="effective-yaml">{yaml}</pre>
  );
}

// ─── Rules tab ────────────────────────────────────────────────────────────────

function RulesTab({ violations }) {
  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  if (violations.length === 0) {
    return <div className="rules-clean">✓ No violations</div>;
  }

  return (
    <div className="rules-panel">
      {errors.length > 0 && (
        <section>
          <h3 className="violations-header error">Errors ({errors.length})</h3>
          {errors.map((v, i) => <ViolationRow key={i} v={v} />)}
        </section>
      )}
      {warnings.length > 0 && (
        <section>
          <h3 className="violations-header warning">Warnings / Accepted deviations ({warnings.length})</h3>
          {warnings.map((v, i) => <ViolationRow key={i} v={v} />)}
        </section>
      )}
    </div>
  );
}

function ViolationRow({ v }) {
  return (
    <div className={`violation ${v.severity}`}>
      <div className="violation-header">
        <span className="rule-id">[{v.ruleId}]</span>
        <span className="svc">{v.service}</span>
        <span className="path muted">&gt; {v.path}</span>
      </div>
      <div className="violation-msg">{v.message}</div>
      {v.deviation && (
        <div className="deviation-note">Deviation: {v.deviation.reason}</div>
      )}
    </div>
  );
}

// ─── Topology tab ─────────────────────────────────────────────────────────────

function TopologyTab({ name, api }) {
  const [topo, setTopo] = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    api(`/api/ecosystems/${name}/effective`).then(d => setTopo(d.topology)).catch(() => {});
  }, [name]);

  if (!topo) return <div className="loading-panel">Loading…</div>;
  if (!topo.nodes?.length) return <div className="empty-panel">No services yet.</div>;

  // Group nodes by domain
  const domains = {};
  for (const node of topo.nodes) {
    const d = node.domain || 'unassigned';
    if (!domains[d]) domains[d] = [];
    domains[d].push(node);
  }

  // Simple grid layout: domains in columns, services as rows
  const CARD_W = 150, CARD_H = 60, PAD = 20, COL_W = 200;
  const domainList = Object.entries(domains);
  const totalW = domainList.length * COL_W + PAD * 2;
  const maxNodes = Math.max(...domainList.map(([, ns]) => ns.length));
  const totalH = maxNodes * (CARD_H + PAD) + 60 + PAD * 2;

  // Build position map
  const positions = {};
  domainList.forEach(([domain, nodes], colIdx) => {
    nodes.forEach((node, rowIdx) => {
      positions[node.id] = {
        x: PAD + colIdx * COL_W + (COL_W - CARD_W) / 2,
        y: 60 + rowIdx * (CARD_H + PAD),
      };
    });
  });

  // Draw edges
  const archetypeColors = {
    http: '#3b82f6', messaging: '#10b981', provider: '#f59e0b',
    adaptor: '#ef4444', worker: '#8b5cf6', gateway: '#06b6d4', 'web-app': '#ec4899',
  };

  return (
    <div className="topology-panel">
      <svg width={totalW} height={totalH} ref={svgRef}>
        {/* Domain labels */}
        {domainList.map(([domain], i) => (
          <text key={domain} x={PAD + i * COL_W + COL_W / 2} y={30}
            textAnchor="middle" fill="var(--muted)" fontSize={11}>
            {domain}
          </text>
        ))}

        {/* Edges */}
        {topo.edges.map((edge, i) => {
          const from = positions[edge.from];
          const to = positions[edge.to];
          if (!from || !to) return null;
          const fx = from.x + CARD_W / 2, fy = from.y + CARD_H / 2;
          const tx = to.x + CARD_W / 2, ty = to.y + CARD_H / 2;
          const color = edge.mode === 'event' ? '#10b981'
            : edge.mode === 'command' ? '#f59e0b'
            : edge.deviation === 'violation' ? '#ef4444'
            : edge.deviation === 'accepted' ? '#f97316'
            : '#64748b';
          const dash = edge.mode === 'event' ? '6,3' : edge.mode === 'command' ? '3,3' : 'none';
          return (
            <g key={i}>
              <line x1={fx} y1={fy} x2={tx} y2={ty}
                stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.7} />
            </g>
          );
        })}

        {/* Nodes */}
        {topo.nodes.map(node => {
          const pos = positions[node.id];
          if (!pos) return null;
          const color = archetypeColors[node.archetype] || '#64748b';
          return (
            <g key={node.id}>
              <rect x={pos.x} y={pos.y} width={CARD_W} height={CARD_H}
                rx={6} fill="var(--surface2)" stroke={color} strokeWidth={1.5} />
              <text x={pos.x + CARD_W / 2} y={pos.y + 22}
                textAnchor="middle" fill="var(--text)" fontSize={12} fontWeight="600">
                {node.id}
              </text>
              <text x={pos.x + CARD_W / 2} y={pos.y + 38}
                textAnchor="middle" fill={color} fontSize={10}>
                {node.archetype}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="topo-legend">
        <span style={{color:'#64748b'}}>── rest</span>
        <span style={{color:'#10b981'}}>╌╌ event</span>
        <span style={{color:'#f59e0b'}}>┄┄ command</span>
        <span style={{color:'#f97316'}}>── accepted deviation</span>
        <span style={{color:'#ef4444'}}>── violation</span>
      </div>
    </div>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ name, api }) {
  const [history, setHistory] = useState(null);
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    api(`/api/ecosystems/${name}/history`).then(h => { setHistory(h); }).catch(() => {});
  }, [name]);

  const loadDiff = (entry, idx) => {
    setSelected(idx);
    if (idx < history.length - 1) {
      const parent = history[idx + 1].sha;
      api(`/api/ecosystems/${name}/diff?from=${parent}&to=${entry.sha}`)
        .then(setDiff).catch(() => setDiff(null));
    } else {
      setDiff(null);
    }
  };

  const undo = async () => {
    if (!window.confirm('Revert HEAD commit?')) return;
    setUndoing(true);
    try {
      await api(`/api/ecosystems/${name}/undo`, 'POST');
      const h = await api(`/api/ecosystems/${name}/history`);
      setHistory(h);
      setSelected(null);
      setDiff(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setUndoing(false);
    }
  };

  if (!history) return <div className="loading-panel">Loading…</div>;

  return (
    <div className="history-panel">
      <div className="commit-list">
        {history.map((h, i) => (
          <div key={h.sha} className={`commit-entry ${selected === i ? 'active' : ''}`}
            onClick={() => loadDiff(h, i)}>
            <span className="sha">{h.sha.slice(0, 7)}</span>
            <span className="summary">{h.summary}</span>
            <span className="author muted">{h.authorName}</span>
          </div>
        ))}
      </div>
      {selected === 0 && (
        <button className="btn-danger undo" onClick={undo} disabled={undoing}>
          {undoing ? 'Undoing…' : 'Undo HEAD'}
        </button>
      )}
      {diff && (
        <div className="diff-panel">
          <pre>{diff.rawDiff}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Versions tab ─────────────────────────────────────────────────────────────

function VersionsTab({ name, api, onPublished }) {
  const [data, setData] = useState(null);
  const [bump, setBump] = useState('');
  const [notes, setNotes] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [blockingViolations, setBlockingViolations] = useState([]);

  const load = useCallback(() => {
    api(`/api/ecosystems/${name}/versions`).then(d => {
      setData(d);
      setBump(d.suggestedBump);
    }).catch(() => {});
  }, [name, api]);

  useEffect(() => { load(); }, [load]);

  const publish = async () => {
    setPublishing(true);
    setBlockingViolations([]);
    try {
      await api(`/api/ecosystems/${name}/versions`, 'POST', { bump, notes });
      load();
      onPublished();
    } catch (e) {
      if (e.message?.includes('blocking')) {
        api(`/api/ecosystems/${name}/violations`).then(vs => setBlockingViolations(vs.filter(v => v.severity === 'error'))).catch(() => {});
      }
      alert(e.message);
    } finally {
      setPublishing(false);
    }
  };

  if (!data) return <div className="loading-panel">Loading…</div>;

  return (
    <div className="versions-panel">
      <div className="publish-form">
        <h3>Publish new version</h3>
        <div className="field">
          <label>Version bump</label>
          <select value={bump} onChange={e => setBump(e.target.value)}>
            <option value="patch">patch</option>
            <option value="minor">minor</option>
            <option value="major">major</option>
          </select>
          {data.suggestedBump && <span className="hint">Suggested: {data.suggestedBump}</span>}
        </div>
        <div className="field">
          <label>Release notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="What changed in this version?" />
        </div>
        {blockingViolations.length > 0 && (
          <div className="blocking-violations">
            <strong>Cannot publish — fix these errors first:</strong>
            {blockingViolations.map((v, i) => <div key={i}>[{v.ruleId}] {v.message}</div>)}
          </div>
        )}
        <button
          className="btn-primary"
          onClick={publish}
          disabled={publishing || blockingViolations.length > 0}
        >
          {publishing ? 'Publishing…' : `Publish ${bump}`}
        </button>
      </div>

      <div className="version-list">
        <h3>Published versions</h3>
        {data.versions?.length === 0 && <div className="empty">No versions published yet.</div>}
        {data.versions?.map(v => (
          <div key={v.tag} className="version-entry">
            <span className="tag">{v.tag}</span>
            <span className="sha muted">{v.sha?.slice(0, 7)}</span>
            <span className="notes muted">{v.notes}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────────

function ApiKeyModal({ api, onClose }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/user/profile', 'PUT', { anthropicApiKey: key, anthropicModel: model });
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Anthropic API Key</h2>
        <p>Enter your Anthropic API key to enable chat. It is stored securely and never logged.</p>
        <div className="field">
          <label>API key (starts with sk-)</label>
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" />
        </div>
        <div className="field">
          <label>Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-opus-4-6">claude-opus-4-6</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !key.startsWith('sk-')}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewEcosystemModal({ api, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      await api('/api/ecosystems', 'POST', { name, description: desc });
      onCreated(name);
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>New Ecosystem</h2>
        <div className="field">
          <label>Name (lowercase, hyphens ok)</label>
          <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="my-system" />
        </div>
        <div className="field">
          <label>Description</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does this system do?" />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={create}
            disabled={creating || !/^[a-z][a-z0-9-]*$/.test(name)}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
