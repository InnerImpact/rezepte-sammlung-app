import {
  loadRecipes, imageUrl, collectTags, saveRecipe,
  isDemoMode, inboxCount, pendingCount, lastSyncTime, flushPending,
  addToIndex, makeId, uploadImage,
  listInbox, addLinkJob, addPhotoJob,
} from './data.js?v=4';
import { getConfig, saveConfig, testConnection } from './github.js?v=4';

const app = document.getElementById('app');

const state = {
  recipes: [],
  tags: [],
  q: '',
  tag: null,
  favOnly: false,
  loaded: false,
  fromCache: false,
  error: null,
  inbox: 0,
  inboxJobs: [],
};

function icon(name, cls = 'icon') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Bilder laden asynchron: Kacheln rendern sofort, Fotos kommen nach
async function hydrateImages(root) {
  const imgs = [...root.querySelectorAll('img[data-recipe-id]')];
  for (const img of imgs) {
    const r = state.recipes.find((x) => x.id === img.dataset.recipeId);
    if (!r) continue;
    imageUrl(r).then((url) => { if (url) img.src = url; });
  }
}

// ---------- Routing ----------

window.addEventListener('hashchange', route);
window.addEventListener('online', async () => {
  const flushed = await flushPending();
  if (flushed > 0) refresh();
});

async function refresh() {
  try {
    const result = await loadRecipes();
    state.recipes = result.recipes;
    state.fromCache = result.fromCache;
    state.tags = collectTags(state.recipes);
    state.error = null;
  } catch (e) {
    state.error = e.message;
    state.recipes = [];
  }
  state.loaded = true;
  listInbox().then((jobs) => {
    state.inboxJobs = jobs;
    if (jobs.length !== state.inbox) {
      state.inbox = jobs.length;
      const el = document.getElementById('inbox-banner-slot');
      if (el) el.innerHTML = inboxBannerHtml();
      const q = document.getElementById('queue-tiles-slot');
      if (q) q.innerHTML = queueTilesHtml();
    }
  });
  route();
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || '';
  window.scrollTo(0, 0);
  if (view === 'rezept') renderDetail(parts[1]);
  else if (view === 'einstellungen') renderSettings();
  else if (view === 'hinzufuegen') renderAddChooser();
  else if (view === 'foto') renderPhoto();
  else if (view === 'link') renderLink();
  else if (view === 'neu') renderEdit(null);
  else if (view === 'bearbeiten') renderEdit(parts[1]);
  else renderHome();
}

// ---------- Übersicht ----------

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.recipes.filter((r) => {
    if (state.favOnly && !r.favorit) return false;
    if (state.tag && !(r.tags || []).includes(state.tag)) return false;
    if (q) {
      const hay = (r.titel + ' ' + (r.zutaten || []).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function inboxBannerHtml() {
  if (!state.inbox) return '';
  const n = state.inbox;
  return `
    <div class="queue-banner">
      ${icon('refresh')}
      <span><strong>${n} ${n === 1 ? 'Rezept wartet' : 'Rezepte warten'}</strong> auf Verarbeitung — dafür muss dein Mac an sein.</span>
    </div>`;
}

function queueTilesHtml() {
  if (!state.inboxJobs.length) return '';
  const label = { instagram: 'Reel', website: 'Rezept-Seite', foto: 'Foto' };
  return `
    <div class="grid queue-grid">
      ${state.inboxJobs.map((j) => `
        <div class="tile queue-tile">
          <div class="img-wrap">
            <span class="queue-ic">${icon('clock')}</span>
          </div>
          <h3>Wird gekocht …</h3>
          <p class="meta">${label[j.typ] || 'Rezept'} in der Warteschlange</p>
        </div>
      `).join('')}
    </div>`;
}

function tilesHtml(list) {
  return list.map((r) => `
    <button class="tile" data-nav="rezept/${esc(r.id)}">
      <div class="img-wrap">
        <img data-recipe-id="${esc(r.id)}" alt="" loading="lazy">
        ${r.favorit ? `<span class="fav-badge">${icon('heart')}</span>` : ''}
      </div>
      <h3>${esc(r.titel)}</h3>
      ${(r.tags || []).length ? `<p class="meta">${esc((r.tags || []).slice(0, 2).join(' · '))}</p>` : ''}
    </button>
  `).join('');
}

function renderHome() {
  if (!state.loaded) {
    app.innerHTML = `
      <div class="header"><h1>Rezepte</h1></div>
      <div class="grid">
        ${'<div class="skeleton" style="aspect-ratio:4/3.4"></div>'.repeat(4)}
      </div>`;
    return;
  }

  const list = filtered();
  const hasAny = state.recipes.length > 0;
  const hasFilter = state.q || state.tag || state.favOnly;
  const noConfig = isDemoMode();

  app.innerHTML = `
    <div class="header">
      <h1>Rezepte</h1>
      <div class="actions">
        <button class="icon-btn" data-nav="einstellungen" aria-label="Einstellungen">${icon('settings')}</button>
      </div>
    </div>

    ${noConfig && hasAny ? '<div class="demo-hint">Demo-Ansicht — verbinde dein Rezept-Archiv unter <a href="#/einstellungen">Einstellungen</a>.</div>' : ''}
    ${state.fromCache ? '<div class="demo-hint">Offline — du siehst den letzten gespeicherten Stand.</div>' : ''}
    <div id="inbox-banner-slot">${inboxBannerHtml()}</div>

    <div class="search-wrap">
      ${icon('search')}
      <input id="search" type="search" placeholder="Rezept oder Zutat suchen"
        value="${esc(state.q)}" autocomplete="off" autocorrect="off">
      ${state.q ? '<button class="search-clear" id="clear-search">Löschen</button>' : ''}
    </div>

    <div class="chips">
      <button class="chip fav ${state.favOnly ? 'active' : ''}" id="chip-fav">
        ${icon('heart')} Favoriten
      </button>
      <button class="chip ${!state.tag ? 'active' : ''}" data-tag="">Alle</button>
      ${state.tags.map((t) => `
        <button class="chip ${state.tag === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>
      `).join('')}
    </div>

    ${hasAny && hasFilter ? `<p class="count-line">${list.length} ${list.length === 1 ? 'Rezept' : 'Rezepte'} gefunden</p>` : ''}

    <div id="queue-tiles-slot">${!hasFilter ? queueTilesHtml() : ''}</div>

    ${list.length ? `<div class="grid">${tilesHtml(list)}</div>` : `
      <div class="empty">
        ${icon('book')}
        <h2>${hasAny ? 'Nichts gefunden' : 'Noch keine Rezepte'}</h2>
        <p>${hasAny
          ? 'Probier einen anderen Suchbegriff oder setz den Filter zurück.'
          : 'Teile ein Reel oder eine Rezept-Seite vom iPhone — dein Mac legt es hier ab. Oder tipp unten auf Plus und trag eins von Hand ein.'}</p>
      </div>
    `}

    <button class="fab" data-nav="hinzufuegen" aria-label="Rezept hinzufügen">${icon('plus')}</button>
  `;

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    state.q = search.value;
    renderResultsOnly();
  });
  document.getElementById('clear-search')?.addEventListener('click', () => {
    state.q = '';
    renderHome();
  });
  document.getElementById('chip-fav').addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    renderHome();
  });
  app.querySelectorAll('.chip[data-tag]').forEach((c) =>
    c.addEventListener('click', () => {
      state.tag = c.dataset.tag || null;
      renderHome();
    })
  );
  bindNav();
  hydrateImages(app);
}

function renderResultsOnly() {
  const old = app.querySelector('.grid, .empty');
  app.querySelector('.count-line')?.remove();
  if (!old) return renderHome();
  const tmp = document.createElement('div');
  const list = filtered();
  tmp.innerHTML = list.length
    ? `<div class="grid">${tilesHtml(list)}</div>`
    : `<div class="empty">${icon('search')}<h2>Nichts gefunden</h2><p>Probier einen anderen Suchbegriff.</p></div>`;
  old.replaceWith(tmp.firstElementChild);
  bindNav();
  hydrateImages(app);
}

// ---------- Rezept-Detail ----------

function checkedKey(id) {
  return `checked_${id}`;
}

function loadChecked(id) {
  try {
    return new Set(JSON.parse(localStorage.getItem(checkedKey(id))) || []);
  } catch {
    return new Set();
  }
}

function renderDetail(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!state.loaded) {
    app.innerHTML = '<div class="skeleton" style="aspect-ratio:4/3;margin:0 -16px"></div>';
    return;
  }
  if (!r) {
    app.innerHTML = `
      <div class="placeholder-page">
        <button class="back-link" data-nav="">${icon('back')} Zurück</button>
        <div class="empty">${icon('book')}<h2>Rezept nicht gefunden</h2></div>
      </div>`;
    bindNav();
    return;
  }

  const checked = loadChecked(id);
  const src = r.quelle === 'instagram' ? 'Instagram' : 'Website';
  const srcIcon = r.quelle === 'instagram' ? 'instagram' : 'globe';

  app.innerHTML = `
    <div class="detail">
      <div class="hero">
        <img data-recipe-id="${esc(r.id)}" alt="${esc(r.titel)}">
        <div class="topbar">
          <button class="round-btn" data-nav="" aria-label="Zurück">${icon('back')}</button>
          <button class="round-btn ${r.favorit ? 'faved' : ''}" id="fav-btn"
            aria-label="${r.favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}">${icon('heart')}</button>
        </div>
      </div>
      <div class="detail-body">
        <h1>${esc(r.titel)}</h1>
        <div class="badges">
          ${r.portionen ? `<span class="badge">${icon('users')} ${esc(r.portionen)}${/^\d+$/.test(r.portionen) ? ' Portionen' : ''}</span>` : ''}
          <span class="badge">${icon(srcIcon)} ${src}</span>
          ${(r.tags || []).map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}
        </div>

        <div class="section-head">
          <h2>Zutaten</h2>
          ${checked.size ? '<button class="sub-action" id="reset-checked">Zurücksetzen</button>' : ''}
        </div>
        <ul class="ingredients">
          ${(r.zutaten || []).map((z, i) => `
            <li>
              <button class="ing-row ${checked.has(i) ? 'checked' : ''}" data-i="${i}">
                <span class="ing-box">${icon('check')}</span>
                <span class="ing-text">${esc(z)}</span>
              </button>
            </li>
          `).join('')}
        </ul>

        <div class="section-head"><h2>Zubereitung</h2></div>
        <ol class="steps">
          ${(r.schritte || []).map((s, i) => `
            <li><span class="step-num">${i + 1}</span><p>${esc(s)}</p></li>
          `).join('')}
        </ol>

        ${r.notiz ? `
          <div class="section-head"><h2>Notiz</h2></div>
          <div class="note-box">${esc(r.notiz)}</div>
        ` : ''}

        <div class="detail-actions">
          ${r.quelle_url ? `
            <a class="btn secondary" href="${esc(r.quelle_url)}" target="_blank" rel="noopener">
              ${icon('external')} Zur Originalquelle
            </a>` : ''}
          <button class="btn secondary" data-nav="bearbeiten/${esc(r.id)}">
            ${icon('edit')} Bearbeiten
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('fav-btn').addEventListener('click', async () => {
    r.favorit = !r.favorit;
    renderDetail(id);
    await saveRecipe(r, `${r.favorit ? 'Favorit' : 'Favorit entfernt'}: ${r.titel}`);
  });

  document.getElementById('reset-checked')?.addEventListener('click', () => {
    localStorage.removeItem(checkedKey(id));
    renderDetail(id);
  });

  app.querySelectorAll('.ing-row').forEach((row) =>
    row.addEventListener('click', () => {
      const i = Number(row.dataset.i);
      const set = loadChecked(id);
      set.has(i) ? set.delete(i) : set.add(i);
      localStorage.setItem(checkedKey(id), JSON.stringify([...set]));
      row.classList.toggle('checked');
      if ((set.size && !document.getElementById('reset-checked')) || !set.size) renderDetail(id);
    })
  );

  bindNav();
  hydrateImages(app);
}

// ---------- Einstellungen ----------

function renderSettings() {
  const cfg = getConfig();
  const sync = lastSyncTime();
  const pend = pendingCount();

  app.innerHTML = `
    <div class="placeholder-page">
      <button class="back-link" data-nav="">${icon('back')} Zurück</button>
      <div class="header" style="padding-top:0"><h1>Einstellungen</h1></div>

      <div class="settings-section">
        <h2>Dein Rezept-Archiv</h2>
        <p class="settings-hint">Die App liest und speichert deine Rezepte in deinem privaten GitHub-Archiv. Trag hier einmal den Zugriffs-Schlüssel ein.</p>

        <label class="field-label" for="set-repo">Archiv (Repo)</label>
        <input id="set-repo" class="field" type="text" placeholder="InnerImpact/rezepte-daten"
          value="${esc(cfg.repo || 'InnerImpact/rezepte-daten')}" autocapitalize="off" autocorrect="off">

        <label class="field-label" for="set-token">Zugriffs-Schlüssel (Token)</label>
        <input id="set-token" class="field" type="password" placeholder="github_pat_…"
          value="${esc(cfg.token)}" autocapitalize="off" autocorrect="off">
        <p class="settings-hint small">Wird nur auf diesem Gerät gespeichert.</p>

        <button class="btn primary" id="save-settings">Verbinden und speichern</button>
        <p id="settings-status" class="settings-status"></p>
      </div>

      <div class="settings-section">
        <h2>Sync</h2>
        <ul class="status-list">
          <li><span>Modus</span><strong>${isDemoMode() ? 'Demo (Beispiel-Rezepte)' : 'Verbunden'}</strong></li>
          <li><span>Rezepte</span><strong>${state.recipes.length}</strong></li>
          <li><span>Zuletzt aktualisiert</span><strong>${sync ? new Date(sync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</strong></li>
          <li><span>Warten auf Verarbeitung</span><strong>${state.inbox}</strong></li>
          <li><span>Nicht hochgeladene Änderungen</span><strong>${pend}</strong></li>
        </ul>
        <button class="btn secondary" id="refresh-now">${icon('refresh')} Jetzt aktualisieren</button>
      </div>
    </div>
  `;

  document.getElementById('save-settings').addEventListener('click', async () => {
    const status = document.getElementById('settings-status');
    const token = document.getElementById('set-token').value.trim();
    const repo = document.getElementById('set-repo').value.trim();
    if (!token || !repo) {
      status.textContent = 'Bitte Archiv und Schlüssel ausfüllen.';
      status.className = 'settings-status err';
      return;
    }
    saveConfig(token, repo);
    status.textContent = 'Prüfe Verbindung …';
    status.className = 'settings-status';
    try {
      await testConnection();
      status.textContent = 'Verbunden! Lade Rezepte …';
      status.className = 'settings-status ok';
      state.loaded = false;
      await refresh();
      location.hash = '#/';
    } catch (e) {
      status.textContent = e.message;
      status.className = 'settings-status err';
    }
  });

  document.getElementById('refresh-now').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    await refresh();
  });

  bindNav();
}

// ---------- Hinzufügen: Auswahl ----------

function renderAddChooser() {
  const demo = isDemoMode();
  app.innerHTML = `
    <div class="placeholder-page">
      <button class="back-link" data-nav="">${icon('back')} Zurück</button>
      <div class="header" style="padding-top:0"><h1>Rezept hinzufügen</h1></div>

      ${demo ? '<div class="demo-hint">Verbinde erst dein Archiv unter <a href="#/einstellungen">Einstellungen</a>, dann kannst du Fotos und Links sammeln.</div>' : ''}

      <div class="choose-list">
        <button class="choose-card" data-nav="foto" ${demo ? 'disabled' : ''}>
          <span class="choose-ic">${icon('camera')}</span>
          <span class="choose-txt">
            <strong>Foto aufnehmen oder hochladen</strong>
            <small>Rezept aus einem Kochbuch, einer Zeitschrift oder einem Screenshot</small>
          </span>
          ${icon('arrow-right', 'icon choose-arrow')}
        </button>

        <button class="choose-card" data-nav="link" ${demo ? 'disabled' : ''}>
          <span class="choose-ic">${icon('link')}</span>
          <span class="choose-txt">
            <strong>Link einfügen</strong>
            <small>Reel oder Rezept-Seite aus dem Netz</small>
          </span>
          ${icon('arrow-right', 'icon choose-arrow')}
        </button>

        <button class="choose-card" data-nav="neu">
          <span class="choose-ic">${icon('pencil')}</span>
          <span class="choose-txt">
            <strong>Von Hand eintippen</strong>
            <small>Zutaten und Schritte selbst eingeben</small>
          </span>
          ${icon('arrow-right', 'icon choose-arrow')}
        </button>
      </div>

      ${!demo ? `
        <p class="settings-hint" style="margin-top:20px">
          Foto und Link kommen in deine Warteschlange. Dein Mac baut daraus die fertige Rezeptkarte, sobald er an ist.
        </p>` : ''}
    </div>
  `;
  bindNav();
}

// ---------- Hinzufügen: Foto ----------

function renderPhoto() {
  if (isDemoMode()) { location.hash = '#/hinzufuegen'; return; }
  app.innerHTML = `
    <div class="placeholder-page">
      <button class="back-link" data-nav="hinzufuegen">${icon('back')} Zurück</button>
      <div class="header" style="padding-top:0"><h1>Foto vom Rezept</h1></div>

      <div class="settings-section">
        <p class="settings-hint">Fotografier die Rezeptseite oder wähle ein Bild aus. Achte auf gutes Licht und dass die ganze Zutatenliste drauf ist.</p>

        <label class="photo-drop" id="photo-drop">
          <input id="photo-input" type="file" accept="image/*" capture="environment" hidden>
          <span id="photo-placeholder">${icon('camera')}<br>Tippen, um Foto aufzunehmen oder auszuwählen</span>
        </label>

        <button class="btn primary" id="photo-save" disabled>Zur Sammlung hinzufügen</button>
        <p id="photo-status" class="settings-status"></p>
      </div>
    </div>
  `;

  let base64 = null;
  const input = document.getElementById('photo-input');
  const drop = document.getElementById('photo-drop');
  const saveBtn = document.getElementById('photo-save');

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const status = document.getElementById('photo-status');
    status.textContent = 'Bild wird vorbereitet …';
    status.className = 'settings-status';
    try {
      base64 = await fileToJpegBase64(file, 1600);
      drop.innerHTML = `<img src="data:image/jpeg;base64,${base64}" alt="Vorschau">`;
      saveBtn.disabled = false;
      status.textContent = '';
    } catch (e) {
      status.textContent = 'Das Bild ließ sich nicht laden. Versuch ein anderes.';
      status.className = 'settings-status err';
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!base64) return;
    const status = document.getElementById('photo-status');
    saveBtn.disabled = true;
    status.textContent = 'Wird zu deiner Warteschlange hinzugefügt …';
    status.className = 'settings-status';
    try {
      await addPhotoJob(base64);
      state.inbox += 1;
      location.hash = '#/';
    } catch (e) {
      saveBtn.disabled = false;
      status.textContent = 'Hat nicht geklappt: ' + e.message + ' — bist du online?';
      status.className = 'settings-status err';
    }
  });

  bindNav();
}

// ---------- Hinzufügen: Link ----------

function renderLink() {
  if (isDemoMode()) { location.hash = '#/hinzufuegen'; return; }
  app.innerHTML = `
    <div class="placeholder-page">
      <button class="back-link" data-nav="hinzufuegen">${icon('back')} Zurück</button>
      <div class="header" style="padding-top:0"><h1>Link einfügen</h1></div>

      <div class="settings-section">
        <p class="settings-hint">Füg den Link zu einem Reel oder einer Rezept-Seite ein. Dein Mac holt sich das Rezept daraus.</p>

        <label class="field-label" for="link-input">Link</label>
        <input id="link-input" class="field" type="url" inputmode="url" placeholder="https://…" autocapitalize="off" autocorrect="off">

        <button class="btn primary" id="link-save">Zur Sammlung hinzufügen</button>
        <p id="link-status" class="settings-status"></p>
      </div>
    </div>
  `;

  const save = async () => {
    const input = document.getElementById('link-input');
    const status = document.getElementById('link-status');
    const url = input.value.trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      status.textContent = 'Bitte einen vollständigen Link einfügen (mit https://).';
      status.className = 'settings-status err';
      return;
    }
    const btn = document.getElementById('link-save');
    btn.disabled = true;
    status.textContent = 'Wird zu deiner Warteschlange hinzugefügt …';
    status.className = 'settings-status';
    try {
      await addLinkJob(url);
      state.inbox += 1;
      location.hash = '#/';
    } catch (e) {
      btn.disabled = false;
      status.textContent = 'Hat nicht geklappt: ' + e.message + ' — bist du online?';
      status.className = 'settings-status err';
    }
  };

  document.getElementById('link-save').addEventListener('click', save);
  document.getElementById('link-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });

  bindNav();
}

// ---------- Bearbeiten / Manuell hinzufügen ----------

async function fileToJpegBase64(file, maxSize = 1200) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return dataUrl.split(',')[1];
}

function renderEdit(id) {
  const isNew = !id;
  const r = isNew
    ? { titel: '', portionen: '', zutaten: [], schritte: [], tags: [], notiz: '', quelle: 'manuell', quelle_url: '', favorit: false }
    : state.recipes.find((x) => x.id === id);

  if (!isNew && !r) {
    renderPlaceholder('Rezept nicht gefunden', 'Geh zurück zur Übersicht.');
    return;
  }

  app.innerHTML = `
    <div class="placeholder-page">
      <button class="back-link" data-nav="${isNew ? '' : 'rezept/' + esc(id)}">${icon('back')} Zurück</button>
      <div class="header" style="padding-top:0"><h1>${isNew ? 'Neues Rezept' : 'Bearbeiten'}</h1></div>

      <div class="settings-section">
        <label class="field-label" for="ed-titel">Titel</label>
        <input id="ed-titel" class="field" type="text" placeholder="z. B. Cremige Zitronen-Pasta" value="${esc(r.titel)}">

        <label class="field-label" for="ed-portionen">Portionen</label>
        <input id="ed-portionen" class="field" type="text" placeholder="z. B. 2 oder 1 Blech" value="${esc(r.portionen)}">

        <label class="field-label" for="ed-zutaten">Zutaten — eine pro Zeile</label>
        <textarea id="ed-zutaten" class="field" rows="7" placeholder="200 g Spaghetti&#10;1 Zitrone">${esc((r.zutaten || []).join('\n'))}</textarea>

        <label class="field-label" for="ed-schritte">Zubereitung — ein Schritt pro Zeile</label>
        <textarea id="ed-schritte" class="field" rows="7" placeholder="Nudeln kochen …">${esc((r.schritte || []).join('\n'))}</textarea>

        <label class="field-label" for="ed-tags">Tags — mit Komma getrennt</label>
        <input id="ed-tags" class="field" type="text" placeholder="schnell, vegetarisch" value="${esc((r.tags || []).join(', '))}">

        <label class="field-label" for="ed-notiz">Notiz</label>
        <textarea id="ed-notiz" class="field" rows="3" placeholder="Eigene Anmerkungen …">${esc(r.notiz || '')}</textarea>

        <label class="field-label" for="ed-url">Link zur Quelle (optional)</label>
        <input id="ed-url" class="field" type="url" placeholder="https://…" value="${esc(r.quelle_url || '')}">

        <label class="field-label" for="ed-bild">Titelbild ${isNew ? '' : 'ersetzen '}(optional)</label>
        <input id="ed-bild" class="field" type="file" accept="image/*">

        <button class="btn primary" id="ed-save">${isNew ? 'Rezept speichern' : 'Änderungen speichern'}</button>
        <p id="ed-status" class="settings-status"></p>
      </div>
    </div>
  `;

  document.getElementById('ed-save').addEventListener('click', async () => {
    const status = document.getElementById('ed-status');
    const titel = document.getElementById('ed-titel').value.trim();
    if (!titel) {
      status.textContent = 'Ein Titel muss mindestens rein.';
      status.className = 'settings-status err';
      return;
    }
    const lines = (sel) => document.getElementById(sel).value.split('\n').map((s) => s.trim()).filter(Boolean);

    const recipe = {
      ...(isNew ? {} : r),
      id: isNew ? makeId(titel) : r.id,
      titel,
      quelle: r.quelle || 'manuell',
      quelle_url: document.getElementById('ed-url').value.trim(),
      titelbild: r.titelbild || '',
      portionen: document.getElementById('ed-portionen').value.trim(),
      zutaten: lines('ed-zutaten'),
      schritte: lines('ed-schritte'),
      tags: document.getElementById('ed-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      favorit: r.favorit || false,
      notiz: document.getElementById('ed-notiz').value.trim(),
      erstellt_am: r.erstellt_am || new Date().toISOString().slice(0, 10),
    };

    status.textContent = 'Speichere …';
    status.className = 'settings-status';

    try {
      const file = document.getElementById('ed-bild').files[0];
      if (file && !isDemoMode()) {
        status.textContent = 'Lade Bild hoch …';
        const b64 = await fileToJpegBase64(file);
        recipe.titelbild = await uploadImage(recipe.id, b64);
      }

      const res = await saveRecipe(recipe, `${isNew ? 'Neu' : 'Bearbeitet'}: ${recipe.titel}`);
      if (isNew) {
        await addToIndex(recipe.id);
        state.recipes.unshift(recipe);
      } else {
        const idx = state.recipes.findIndex((x) => x.id === recipe.id);
        if (idx >= 0) state.recipes[idx] = recipe;
      }
      state.tags = collectTags(state.recipes);

      if (res.queued) {
        status.textContent = 'Offline gespeichert — wird hochgeladen, sobald du wieder Netz hast.';
        status.className = 'settings-status ok';
        setTimeout(() => { location.hash = '#/rezept/' + recipe.id; }, 1200);
      } else {
        location.hash = '#/rezept/' + recipe.id;
      }
    } catch (e) {
      status.textContent = 'Speichern fehlgeschlagen: ' + e.message;
      status.className = 'settings-status err';
    }
  });

  bindNav();
}

// ---------- Platzhalter ----------

function renderPlaceholder(title, text) {
  app.innerHTML = `
    <div class="placeholder-page">
      <button class="back-link" data-nav="">${icon('back')} Zurück</button>
      <div class="empty">
        ${icon('book')}
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
      </div>
    </div>`;
  bindNav();
}

// ---------- Navigation ----------

function bindNav() {
  app.querySelectorAll('[data-nav]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (el.tagName === 'A') return;
      e.preventDefault();
      location.hash = '#/' + el.dataset.nav;
    })
  );
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

refresh();
