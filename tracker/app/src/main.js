import './style.css'
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

const supabasePublic = createClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  },
})

const LOGIN_ALIASES = {
  marta: 'm.tomaszewska1994@gmail.com',
}

const STATUS_OPTIONS = [
  ['todo', 'Do zrobienia'],
  ['contacted', 'Napisane'],
  ['replied', 'Odpowiedź'],
  ['interview', 'Rozmowa'],
  ['rejected', 'Odrzucone'],
  ['hired', 'Hired'],
  ['skip', 'Skip'],
]

const app = document.querySelector('#app')
let state = {
  session: null,
  jobs: [],
  outreach: {},
  q: '',
  fit: 'all',
  source: 'all',
  status: 'all',
  openId: null,
  saving: null,
  error: '',
  warning: '',
}

function resolveEmail(login) {
  const raw = login.trim().toLowerCase()
  return LOGIN_ALIASES[raw] || raw
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function clockSkewHint(message = '') {
  const m = String(message || '')
  if (/issued at future|iat/i.test(m)) {
    return 'Zegar systemu/przeglądarki jest prawdopodobnie spóźniony. Włącz automatyczną datę i godzinę, potem wyloguj i zaloguj ponownie.'
  }
  return ''
}

async function loadJobs() {
  const { data, error } = await supabasePublic
    .from('jobs')
    .select('*')
    .eq('is_active', true)
    .order('fit_score', { ascending: false })
    .order('priority', { ascending: true })
    .order('company')
  if (error) throw error
  state.jobs = data || []
}

async function loadOutreach() {
  if (!state.session) {
    state.outreach = {}
    return
  }
  const { data, error } = await supabase.from('outreach').select('*')
  if (error) {
    state.warning = clockSkewHint(error.message) || error.message
    state.outreach = {}
    return
  }
  state.warning = ''
  state.outreach = Object.fromEntries((data || []).map((o) => [o.job_id, o]))
}

async function loadData() {
  await loadJobs()
  await loadOutreach()
}

function filtered() {
  return state.jobs.filter((j) => {
    const o = state.outreach[j.id]
    const st = o?.status || 'todo'
    if (state.fit !== 'all' && String(j.fit_score) !== state.fit) return false
    if (state.source !== 'all' && !(j.source || '').includes(state.source)) return false
    if (state.status !== 'all' && st !== state.status) return false
    if (state.q) {
      const hay = `${j.title} ${j.company} ${j.location} ${j.fit_reason} ${j.description} ${j.source}`.toLowerCase()
      if (!hay.includes(state.q.toLowerCase())) return false
    }
    return true
  })
}

function stats() {
  const all = state.jobs.length
  const top = state.jobs.filter((j) => j.fit_score >= 4).length
  const contacted = Object.values(state.outreach).filter((o) =>
    ['contacted', 'replied', 'interview', 'hired'].includes(o.status)
  ).length
  const interviews = Object.values(state.outreach).filter((o) => o.status === 'interview').length
  return { all, top, contacted, interviews }
}

async function upsertOutreach(jobId, patch) {
  state.saving = jobId
  render()
  const existing = state.outreach[jobId]
  const payload = {
    job_id: jobId,
    user_id: state.session.user.id,
    status: patch.status ?? existing?.status ?? 'todo',
    comment: patch.comment ?? existing?.comment ?? '',
    contacted_at: patch.contacted_at ?? existing?.contacted_at ?? null,
    updated_at: new Date().toISOString(),
  }
  if (payload.status === 'contacted' && !payload.contacted_at) {
    payload.contacted_at = new Date().toISOString().slice(0, 10)
  }
  const { data, error } = await supabase
    .from('outreach')
    .upsert(payload, { onConflict: 'user_id,job_id' })
    .select()
    .single()
  state.saving = null
  if (error) {
    state.error = error.message
    state.warning = clockSkewHint(error.message)
    render()
    return
  }
  state.outreach[jobId] = data
  state.error = ''
  state.warning = ''
  render()
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth">
      <form class="auth-card" id="login-form">
        <h1>Marta · Role Tracker</h1>
        <p>Aktywne oferty People / HR Ops dopasowane do profilu · Wrocław + remote PL</p>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
        ${state.warning ? `<p class="error">${escapeHtml(state.warning)}</p>` : ''}
        <label for="login">Login (marta) lub email</label>
        <input id="login" name="login" autocomplete="username" value="marta" required />
        <label for="password">Hasło</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Zaloguj</button>
      </form>
    </div>
  `
  document.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    const email = resolveEmail(fd.get('login'))
    const password = String(fd.get('password'))
    state.error = ''
    state.warning = ''
    const btn = e.target.querySelector('button')
    btn.disabled = true
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    btn.disabled = false
    if (error) {
      state.error = error.message
      state.warning = clockSkewHint(error.message)
      renderLogin()
      return
    }
    state.session = data.session
    await bootApp()
  })
}

function renderApp() {
  const rows = filtered()
  const s = stats()
  const sources = [...new Set(state.jobs.map((j) => (j.source || '').split(' ')[0].replace('/', '')))].filter(Boolean).sort()

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div>
          <h1>Role fit · Marta</h1>
          <div class="meta">${s.all} aktywnych · ${s.top} top fit (4–5) · ${escapeHtml(state.session.user.email)}</div>
        </div>
        <button class="secondary" id="logout">Wyloguj</button>
      </header>

      ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      ${state.warning ? `<p class="error">${escapeHtml(state.warning)}</p>` : ''}

      <div class="stats">
        <span class="chip">Widoczne: ${rows.length}</span>
        <span class="chip">Napisane+: ${s.contacted}</span>
        <span class="chip">Rozmowy: ${s.interviews}</span>
      </div>

      <div class="filters">
        <input id="q" placeholder="Szukaj: rola, firma, fit, źródło..." value="${escapeHtml(state.q)}" />
        <select id="fit">
          <option value="all">Fit: wszystkie</option>
          <option value="5" ${state.fit === '5' ? 'selected' : ''}>Fit 5</option>
          <option value="4" ${state.fit === '4' ? 'selected' : ''}>Fit 4</option>
          <option value="3" ${state.fit === '3' ? 'selected' : ''}>Fit 3</option>
          <option value="2" ${state.fit === '2' ? 'selected' : ''}>Fit 2</option>
        </select>
        <select id="source">
          <option value="all">Źródło: wszystkie</option>
          ${sources.map((x) => `<option value="${escapeHtml(x)}" ${state.source === x ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}
        </select>
        <select id="status">
          <option value="all">Status: wszystkie</option>
          ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${state.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>

      <div class="list">
        ${rows.map((j) => {
          const o = state.outreach[j.id] || { status: 'todo', comment: '' }
          const saving = state.saving === j.id
          const open = state.openId === j.id
          return `
            <article class="row status-${escapeHtml(o.status || 'todo')}" data-id="${j.id}">
              <div class="row-main">
                <div class="row-title">
                  <span class="fit-badge f${j.fit_score}">${j.fit_score}</span>
                  <div>
                    <h2>${escapeHtml(j.title)}</h2>
                    <div class="sub">${escapeHtml(j.company)} · ${escapeHtml(j.location)} · ${escapeHtml(j.work_mode || '')}</div>
                  </div>
                </div>
                <div class="row-side">
                  <a class="apply" href="${escapeHtml(j.url)}" target="_blank" rel="noopener">Oferta</a>
                  <span class="src">${escapeHtml(j.source || '')}</span>
                </div>
              </div>
              <p class="fit-line">${escapeHtml(j.fit_reason)}</p>
              <div class="row-actions">
                <select class="status-select" ${saving ? 'disabled' : ''}>
                  ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <input class="comment" placeholder="Notatka..." value="${escapeHtml(o.comment || '')}" ${saving ? 'disabled' : ''} />
                <button class="save" ${saving ? 'disabled' : ''}>${saving ? '…' : 'Zapisz'}</button>
                <button type="button" class="secondary toggle">${open ? 'Mniej' : 'Opis'}</button>
              </div>
              ${open ? `<div class="desc"><strong>Opis:</strong> ${escapeHtml(j.description)}<br/><span class="meta">Verified: ${escapeHtml(j.verified_at || '')}</span></div>` : ''}
            </article>
          `
        }).join('') || '<p class="meta">Brak wyników dla filtrów.</p>'}
      </div>
    </div>
  `

  document.querySelector('#logout').onclick = async () => {
    await supabase.auth.signOut()
    state.session = null
    renderLogin()
  }

  document.querySelector('#q').oninput = (e) => {
    state.q = e.target.value
    clearTimeout(window.__qTimer)
    window.__qTimer = setTimeout(() => renderApp(), 160)
  }
  document.querySelector('#fit').onchange = (e) => { state.fit = e.target.value; renderApp() }
  document.querySelector('#source').onchange = (e) => { state.source = e.target.value; renderApp() }
  document.querySelector('#status').onchange = (e) => { state.status = e.target.value; renderApp() }

  document.querySelectorAll('.row').forEach((row) => {
    const id = row.dataset.id
    row.querySelector('.save').onclick = async () => {
      const status = row.querySelector('.status-select').value
      const comment = row.querySelector('.comment').value
      await upsertOutreach(id, { status, comment })
    }
    row.querySelector('.toggle').onclick = () => {
      state.openId = state.openId === id ? null : id
      renderApp()
    }
  })
}

function render() {
  if (!state.session) renderLogin()
  else renderApp()
}

async function bootApp() {
  try {
    state.error = ''
    await loadData()
    renderApp()
  } catch (e) {
    state.error = e.message || String(e)
    state.warning = clockSkewHint(e.message)
    renderApp()
  }
}

const { data } = await supabase.auth.getSession()
state.session = data.session
if (state.session) await bootApp()
else renderLogin()

supabase.auth.onAuthStateChange(async (event, session) => {
  state.session = session
  if (!session) {
    renderLogin()
    return
  }
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
    try { await loadOutreach() } catch {}
  }
})
