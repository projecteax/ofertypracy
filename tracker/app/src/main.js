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

const MARTA = {
  name: 'Marta Tomaszewska',
  phone: '+48 538 324 450',
  email: 'm.tomaszewska1994@gmail.com',
}

const STATUS_OPTIONS = [
  ['todo', 'Do zrobienia'],
  ['contacted', 'Zaaplikowane'],
  ['replied', 'Odpowiedź'],
  ['interview', 'Rozmowa'],
  ['rejected', 'Odrzucone'],
  ['hired', 'Hired'],
  ['skip', 'Skip'],
]

const APP_STATUS_OPTIONS = [
  ['applied', 'Zaaplikowane'],
  ['replied', 'Odpowiedź'],
  ['interview', 'Rozmowa'],
  ['rejected', 'Odrzucone'],
  ['hired', 'Hired'],
]

const APP_FROM_OUTREACH = {
  contacted: 'applied',
  replied: 'replied',
  interview: 'interview',
  rejected: 'rejected',
  hired: 'hired',
}

const app = document.querySelector('#app')
let state = {
  session: null,
  tab: 'jobs',
  jobs: [],
  outreach: {},
  applications: [],
  q: '',
  fit: 'all',
  source: 'all',
  status: 'all',
  appStatus: 'all',
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

async function loadApplications() {
  if (!state.session) {
    state.applications = []
    return
  }
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('applied_at', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) {
    state.warning = clockSkewHint(error.message) || error.message
    state.applications = []
    return
  }
  state.applications = data || []
}

async function loadData() {
  await loadJobs()
  await Promise.all([loadOutreach(), loadApplications()])
}

function filteredJobs() {
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

function filteredApplications() {
  return state.applications.filter((a) => {
    if (state.appStatus !== 'all' && a.status !== state.appStatus) return false
    if (state.q) {
      const hay = `${a.title} ${a.company} ${a.url} ${a.contact_email} ${a.note}`.toLowerCase()
      if (!hay.includes(state.q.toLowerCase())) return false
    }
    return true
  })
}

function stats() {
  const all = state.jobs.length
  const top = state.jobs.filter((j) => j.fit_score >= 4).length
  const applied = state.applications.filter((a) => a.status !== 'rejected').length
  const rejected = state.applications.filter((a) => a.status === 'rejected').length
  const interviews = state.applications.filter((a) => a.status === 'interview').length
  return { all, top, applied, rejected, interviews }
}

async function upsertApplicationFromJob(job, outreachStatus, note = '') {
  const appStatus = APP_FROM_OUTREACH[outreachStatus]
  if (!appStatus) return

  const existing = state.applications.find((a) => a.job_id === job.id)
  const payload = {
    user_id: state.session.user.id,
    job_id: job.id,
    title: job.title,
    company: job.company,
    url: job.url,
    contact_email: existing?.contact_email || '',
    applicant_name: existing?.applicant_name || MARTA.name,
    applicant_phone: existing?.applicant_phone || MARTA.phone,
    applicant_email: existing?.applicant_email || MARTA.email,
    status: appStatus,
    note: note || existing?.note || '',
    applied_at: existing?.applied_at || new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  }

  let data
  let error
  if (existing) {
    ;({ data, error } = await supabase
      .from('applications')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single())
  } else {
    ;({ data, error } = await supabase.from('applications').insert(payload).select().single())
  }
  if (error) throw error
  const rest = state.applications.filter((a) => a.id !== data.id)
  state.applications = [data, ...rest]
}

async function upsertOutreach(jobId, patch) {
  state.saving = jobId
  render()
  const existing = state.outreach[jobId]
  const job = state.jobs.find((j) => j.id === jobId)
  const payload = {
    job_id: jobId,
    user_id: state.session.user.id,
    status: patch.status ?? existing?.status ?? 'todo',
    comment: patch.comment ?? existing?.comment ?? '',
    contacted_at: patch.contacted_at ?? existing?.contacted_at ?? null,
    updated_at: new Date().toISOString(),
  }
  if (['contacted', 'rejected'].includes(payload.status) && !payload.contacted_at) {
    payload.contacted_at = new Date().toISOString().slice(0, 10)
  }
  const { data, error } = await supabase
    .from('outreach')
    .upsert(payload, { onConflict: 'user_id,job_id' })
    .select()
    .single()
  if (error) {
    state.saving = null
    state.error = error.message
    state.warning = clockSkewHint(error.message)
    render()
    return
  }
  state.outreach[jobId] = data

  try {
    if (job && APP_FROM_OUTREACH[payload.status]) {
      await upsertApplicationFromJob(job, payload.status, payload.comment)
    }
  } catch (e) {
    state.warning = e.message || String(e)
  }

  state.saving = null
  state.error = ''
  render()
}

async function createManualApplication(fields) {
  const payload = {
    user_id: state.session.user.id,
    job_id: null,
    title: fields.title || 'Aplikacja',
    company: fields.company || '',
    url: fields.url,
    contact_email: fields.contact_email || '',
    applicant_name: fields.applicant_name || MARTA.name,
    applicant_phone: fields.applicant_phone || MARTA.phone,
    applicant_email: fields.applicant_email || MARTA.email,
    status: fields.status || 'applied',
    note: fields.note || '',
    applied_at: fields.applied_at || new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('applications').insert(payload).select().single()
  if (error) throw error
  state.applications = [data, ...state.applications]
}

async function updateApplication(id, patch) {
  const { data, error } = await supabase
    .from('applications')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  state.applications = state.applications.map((a) => (a.id === id ? data : a))
}

async function deleteApplication(id) {
  const { error } = await supabase.from('applications').delete().eq('id', id)
  if (error) throw error
  state.applications = state.applications.filter((a) => a.id !== id)
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth">
      <form class="auth-card" id="login-form">
        <h1>Marta · Role Tracker</h1>
        <p>Oferty People / HR Ops + lista Twoich aplikacji</p>
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

function renderShell(inner) {
  const s = stats()
  return `
    <div class="shell">
      <header class="topbar">
        <div>
          <h1>Role fit · Marta</h1>
          <div class="meta">${s.all} ofert · ${s.applied} aplikacji · ${escapeHtml(state.session.user.email)}</div>
        </div>
        <button class="secondary" id="logout">Wyloguj</button>
      </header>

      <nav class="tabs">
        <button type="button" class="tab ${state.tab === 'jobs' ? 'active' : ''}" data-tab="jobs">Oferty</button>
        <button type="button" class="tab ${state.tab === 'apps' ? 'active' : ''}" data-tab="apps">Moje aplikacje (${state.applications.length})</button>
      </nav>

      ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      ${state.warning ? `<p class="error">${escapeHtml(state.warning)}</p>` : ''}

      ${inner}
    </div>
  `
}

function renderJobsTab() {
  const rows = filteredJobs()
  const s = stats()
  const sources = [...new Set(state.jobs.map((j) => (j.source || '').split(' ')[0].replace('/', '')))]
    .filter(Boolean)
    .sort()

  return `
    <div class="stats">
      <span class="chip">Widoczne: ${rows.length}</span>
      <span class="chip">Top fit: ${s.top}</span>
      <span class="chip">Aplikacje: ${s.applied}</span>
      <span class="chip">Rozmowy: ${s.interviews}</span>
    </div>

    <div class="filters">
      <input id="q" placeholder="Szukaj: rola, firma, fit..." value="${escapeHtml(state.q)}" />
      <select id="fit">
        <option value="all">Fit: wszystkie</option>
        ${[5, 4, 3, 2].map((n) => `<option value="${n}" ${state.fit === String(n) ? 'selected' : ''}>Fit ${n}</option>`).join('')}
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
            <div class="quick">
              <button type="button" class="quick-applied" ${saving ? 'disabled' : ''}>Zaaplikowałam</button>
              <button type="button" class="secondary quick-rejected" ${saving ? 'disabled' : ''}>Odrzucone</button>
            </div>
            <div class="row-actions">
              <select class="status-select" ${saving ? 'disabled' : ''}>
                ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
              <input class="comment" placeholder="Notatka / email rekrutera..." value="${escapeHtml(o.comment || '')}" ${saving ? 'disabled' : ''} />
              <button class="save" ${saving ? 'disabled' : ''}>${saving ? '…' : 'Zapisz'}</button>
              <button type="button" class="secondary toggle">${open ? 'Mniej' : 'Opis'}</button>
            </div>
            ${open ? `<div class="desc"><strong>Opis:</strong> ${escapeHtml(j.description)}<br/><span class="meta">Verified: ${escapeHtml(j.verified_at || '')}</span></div>` : ''}
          </article>
        `
      }).join('') || '<p class="meta">Brak wyników dla filtrów.</p>'}
    </div>
  `
}

function renderAppsTab() {
  const rows = filteredApplications()
  return `
    <div class="stats">
      <span class="chip">Na liście: ${rows.length}</span>
      <span class="chip">Aktywne: ${stats().applied}</span>
      <span class="chip">Odrzucone: ${stats().rejected}</span>
    </div>

    <section class="panel">
      <h2 class="panel-title">Dodaj aplikację</h2>
      <p class="meta">Dane kontaktowe Marty są już uzupełnione — dopisz link oferty i email, na który poszła aplikacja.</p>
      <form id="add-app" class="add-form">
        <label>Link do oferty / aplikacji *</label>
        <input name="url" type="url" required placeholder="https://..." />
        <div class="grid-2">
          <div>
            <label>Email rekrutera / kontakt</label>
            <input name="contact_email" type="email" placeholder="recruiter@firma.pl" />
          </div>
          <div>
            <label>Data aplikacji</label>
            <input name="applied_at" type="date" value="${new Date().toISOString().slice(0, 10)}" />
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label>Stanowisko</label>
            <input name="title" placeholder="np. People Ops Specialist" />
          </div>
          <div>
            <label>Firma</label>
            <input name="company" placeholder="np. Aliaxis" />
          </div>
        </div>
        <div class="grid-3">
          <div>
            <label>Imię i nazwisko</label>
            <input name="applicant_name" value="${escapeHtml(MARTA.name)}" />
          </div>
          <div>
            <label>Telefon</label>
            <input name="applicant_phone" value="${escapeHtml(MARTA.phone)}" />
          </div>
          <div>
            <label>Twój email</label>
            <input name="applicant_email" type="email" value="${escapeHtml(MARTA.email)}" />
          </div>
        </div>
        <label>Notatka</label>
        <input name="note" placeholder="np. aplikacja przez Pracuj + LinkedIn" />
        <button type="submit">Dodaj do Moich aplikacji</button>
      </form>
    </section>

    <div class="filters apps-filters">
      <input id="q" placeholder="Szukaj w aplikacjach..." value="${escapeHtml(state.q)}" />
      <select id="appStatus">
        <option value="all">Status: wszystkie</option>
        ${APP_STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${state.appStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>

    <div class="list">
      ${rows.map((a) => {
        const saving = state.saving === a.id
        return `
          <article class="row status-${escapeHtml(a.status === 'applied' ? 'contacted' : a.status)}" data-app-id="${a.id}">
            <div class="row-main">
              <div class="row-title">
                <span class="fit-badge app">${a.job_id ? 'J' : 'M'}</span>
                <div>
                  <h2>${escapeHtml(a.title || 'Aplikacja')}</h2>
                  <div class="sub">${escapeHtml(a.company || '—')} · ${escapeHtml(a.applied_at || '')}${a.job_id ? ' · z listy ofert' : ' · ręczna'}</div>
                </div>
              </div>
              <div class="row-side">
                <a class="apply" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Link</a>
              </div>
            </div>
            <div class="app-meta">
              <span><strong>Kontakt:</strong> ${escapeHtml(a.contact_email || '—')}</span>
              <span><strong>CV jako:</strong> ${escapeHtml(a.applicant_name)} · ${escapeHtml(a.applicant_phone)} · ${escapeHtml(a.applicant_email)}</span>
            </div>
            <div class="row-actions">
              <select class="status-select" ${saving ? 'disabled' : ''}>
                ${APP_STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${a.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
              <input class="comment" placeholder="Notatka / email..." value="${escapeHtml(a.note || '')}" ${saving ? 'disabled' : ''} />
              <input class="contact" placeholder="Email kontaktu" value="${escapeHtml(a.contact_email || '')}" ${saving ? 'disabled' : ''} />
              <button class="save" ${saving ? 'disabled' : ''}>${saving ? '…' : 'Zapisz'}</button>
              <button type="button" class="secondary delete" ${saving ? 'disabled' : ''}>Usuń</button>
            </div>
          </article>
        `
      }).join('') || '<p class="meta">Brak aplikacji — dodaj ręcznie albo kliknij „Zaaplikowałam” przy ofercie.</p>'}
    </div>
  `
}

function bindShell() {
  document.querySelector('#logout').onclick = async () => {
    await supabase.auth.signOut()
    state.session = null
    renderLogin()
  }
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      state.tab = btn.dataset.tab
      state.q = ''
      renderApp()
    }
  })
}

function renderApp() {
  const inner = state.tab === 'apps' ? renderAppsTab() : renderJobsTab()
  app.innerHTML = renderShell(inner)
  bindShell()

  if (state.tab === 'jobs') {
    document.querySelector('#q').oninput = (e) => {
      state.q = e.target.value
      clearTimeout(window.__qTimer)
      window.__qTimer = setTimeout(() => renderApp(), 160)
    }
    document.querySelector('#fit').onchange = (e) => { state.fit = e.target.value; renderApp() }
    document.querySelector('#source').onchange = (e) => { state.source = e.target.value; renderApp() }
    document.querySelector('#status').onchange = (e) => { state.status = e.target.value; renderApp() }

    document.querySelectorAll('.row[data-id]').forEach((row) => {
      const id = row.dataset.id
      row.querySelector('.save').onclick = async () => {
        await upsertOutreach(id, {
          status: row.querySelector('.status-select').value,
          comment: row.querySelector('.comment').value,
        })
      }
      row.querySelector('.quick-applied').onclick = async () => {
        await upsertOutreach(id, {
          status: 'contacted',
          comment: row.querySelector('.comment').value,
        })
        state.tab = 'apps'
        renderApp()
      }
      row.querySelector('.quick-rejected').onclick = async () => {
        await upsertOutreach(id, {
          status: 'rejected',
          comment: row.querySelector('.comment').value,
        })
        state.tab = 'apps'
        renderApp()
      }
      row.querySelector('.toggle').onclick = () => {
        state.openId = state.openId === id ? null : id
        renderApp()
      }
    })
    return
  }

  document.querySelector('#q').oninput = (e) => {
    state.q = e.target.value
    clearTimeout(window.__qTimer)
    window.__qTimer = setTimeout(() => renderApp(), 160)
  }
  document.querySelector('#appStatus').onchange = (e) => { state.appStatus = e.target.value; renderApp() }

  document.querySelector('#add-app').onsubmit = async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    state.saving = 'new'
    state.error = ''
    try {
      await createManualApplication({
        url: String(fd.get('url') || '').trim(),
        contact_email: String(fd.get('contact_email') || '').trim(),
        title: String(fd.get('title') || '').trim(),
        company: String(fd.get('company') || '').trim(),
        applicant_name: String(fd.get('applicant_name') || '').trim(),
        applicant_phone: String(fd.get('applicant_phone') || '').trim(),
        applicant_email: String(fd.get('applicant_email') || '').trim(),
        note: String(fd.get('note') || '').trim(),
        applied_at: String(fd.get('applied_at') || '').trim(),
        status: 'applied',
      })
      state.saving = null
      renderApp()
    } catch (err) {
      state.saving = null
      state.error = err.message || String(err)
      renderApp()
    }
  }

  document.querySelectorAll('.row[data-app-id]').forEach((row) => {
    const id = row.dataset.appId
    row.querySelector('.save').onclick = async () => {
      const patch = {
        status: row.querySelector('.status-select').value,
        note: row.querySelector('.comment').value,
        contact_email: row.querySelector('.contact').value,
      }
      state.saving = id
      state.error = ''
      renderApp()
      try {
        await updateApplication(id, patch)
        state.saving = null
        renderApp()
      } catch (err) {
        state.saving = null
        state.error = err.message || String(err)
        renderApp()
      }
    }
    row.querySelector('.delete').onclick = async () => {
      if (!confirm('Usunąć tę aplikację z listy?')) return
      state.saving = id
      try {
        await deleteApplication(id)
        state.saving = null
        renderApp()
      } catch (err) {
        state.saving = null
        state.error = err.message || String(err)
        renderApp()
      }
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
    try {
      await Promise.all([loadOutreach(), loadApplications()])
    } catch {}
  }
})
