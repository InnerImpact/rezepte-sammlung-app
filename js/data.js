// Datenschicht — zwei Modi:
// Demo-Modus (kein Token hinterlegt): liest aus dem lokalen demo/-Ordner.
// GitHub-Modus: liest/schreibt das private Daten-Repo, cached offline
// und merkt sich Änderungen in einer Warteschlange, wenn gerade kein Netz da ist.

import * as gh from './github.js?v=4';

const OVERRIDES_KEY = 'rezepte_overrides';
const CACHE_KEY = 'rezepte_cache';
const PENDING_KEY = 'rezepte_pending';
const IMG_CACHE = 'rezepte-img-v1';

export function isDemoMode() {
  const { token, repo } = gh.getConfig();
  return !(token && repo);
}

// ---------- Overrides (lokale Änderungen als Overlay) ----------

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveOverride(id, patch) {
  const all = loadOverrides();
  all[id] = { ...(all[id] || {}), ...patch };
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
}

// ---------- Offline-Cache (Rezepte als Ganzes) ----------

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

function writeCache(recipes) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), recipes }));
}

export function lastSyncTime() {
  return readCache()?.at || null;
}

// ---------- Warteschlange für Schreib-Aktionen offline ----------

function readPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
  } catch {
    return [];
  }
}

function writePending(list) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

export function pendingCount() {
  return readPending().length;
}

export async function flushPending() {
  if (isDemoMode()) return 0;
  let list = readPending();
  let done = 0;
  while (list.length) {
    const item = list[0];
    try {
      if (item.type === 'index-add') {
        await addToIndexNow(item.id);
      } else {
        await gh.putFile(`recipes/${item.id}.json`, JSON.stringify(item.data, null, 2), item.message);
      }
      list.shift();
      writePending(list);
      done++;
    } catch {
      break;
    }
  }
  return done;
}

// ---------- Index pflegen + neue Rezepte ----------

async function addToIndexNow(id) {
  const index = await gh.fetchJson('recipes/index.json');
  if (!index.rezepte.includes(id)) {
    index.rezepte.unshift(id);
    await gh.putFile('recipes/index.json', JSON.stringify(index, null, 2), `Index: ${id} ergänzt`);
  }
}

export async function addToIndex(id) {
  if (isDemoMode()) return { queued: false };
  try {
    await addToIndexNow(id);
    return { queued: false };
  } catch {
    const list = readPending();
    list.push({ type: 'index-add', id });
    writePending(list);
    return { queued: true };
  }
}

export function makeId(titel) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = (titel || 'rezept')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'rezept';
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}-${slug}-${rand}`;
}

export async function uploadImage(id, base64Jpeg) {
  const path = `images/${id}.jpg`;
  await gh.putFile(path, base64Jpeg, `Titelbild: ${id}`, { isBase64: true });
  return path;
}

// ---------- Rezepte laden ----------

function sortRecipes(recipes) {
  return recipes
    .filter(Boolean)
    .sort((a, b) => (b.erstellt_am || '').localeCompare(a.erstellt_am || ''));
}

async function loadDemo() {
  const index = await (await fetch('demo/recipes/index.json')).json();
  const overrides = loadOverrides();
  const recipes = await Promise.all(
    (index.rezepte || []).map(async (id) => {
      try {
        const r = await (await fetch(`demo/recipes/${id}.json`)).json();
        return { ...r, ...(overrides[id] || {}) };
      } catch {
        return null;
      }
    })
  );
  return sortRecipes(recipes);
}

async function loadGithub() {
  const index = await gh.fetchJson('recipes/index.json');
  const recipes = await Promise.all(
    (index.rezepte || []).map(async (id) => {
      try {
        return await gh.fetchJson(`recipes/${id}.json`);
      } catch {
        return null;
      }
    })
  );
  const sorted = sortRecipes(recipes);
  writeCache(sorted);
  return sorted;
}

export async function loadRecipes() {
  if (isDemoMode()) return { recipes: await loadDemo(), fromCache: false };
  try {
    await flushPending();
    return { recipes: await loadGithub(), fromCache: false };
  } catch (e) {
    const cached = readCache();
    if (cached?.recipes?.length) return { recipes: cached.recipes, fromCache: true, error: e.message };
    throw e;
  }
}

// ---------- Bilder ----------

const objectUrls = new Map();

export async function imageUrl(recipe) {
  if (!recipe.titelbild) return null;
  if (isDemoMode()) return 'demo/' + recipe.titelbild;

  const path = recipe.titelbild;
  if (objectUrls.has(path)) return objectUrls.get(path);

  const cache = 'caches' in window ? await caches.open(IMG_CACHE) : null;
  const cacheKey = new Request('https://rezepte.local/' + path);
  let res = cache ? await cache.match(cacheKey) : null;
  if (!res) {
    try {
      res = await gh.fetchRaw(path);
      if (cache) await cache.put(cacheKey, res.clone());
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(await res.blob());
  objectUrls.set(path, url);
  return url;
}

// ---------- Schreiben ----------

export async function saveRecipe(recipe, message) {
  saveOverride(recipe.id, recipe);
  if (isDemoMode()) return { queued: false };
  try {
    await gh.putFile(`recipes/${recipe.id}.json`, JSON.stringify(recipe, null, 2), message);
    return { queued: false };
  } catch {
    const list = readPending().filter((p) => p.id !== recipe.id);
    list.push({ id: recipe.id, data: recipe, message });
    writePending(list);
    return { queued: true };
  }
}

// ---------- Warteschlange (Inbox) ----------
// Ein Job ist eine kleine JSON-Datei in inbox/. Der Mac-Koch liest sie,
// baut daraus die Rezeptkarte und löscht den Job wieder.

export async function inboxCount() {
  if (isDemoMode()) return 0;
  try {
    const items = await gh.listDir('inbox');
    return items.filter((i) => i.name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

export async function listInbox() {
  if (isDemoMode()) return [];
  try {
    const items = await gh.listDir('inbox');
    const jobs = await Promise.all(
      items.filter((i) => i.name.endsWith('.json')).map(async (i) => {
        try {
          return await gh.fetchJson(`inbox/${i.name}`);
        } catch {
          return null;
        }
      })
    );
    return jobs.filter(Boolean).sort((a, b) => (b.erstellt_am || '').localeCompare(a.erstellt_am || ''));
  } catch {
    return [];
  }
}

function makeJobId() {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}-${rand}`;
}

export async function addLinkJob(url) {
  const jobId = makeJobId();
  const typ = /instagram\.com/i.test(url) ? 'instagram' : 'website';
  const job = { job_id: jobId, typ, quelle_url: url.trim(), status: 'wartet', erstellt_am: new Date().toISOString() };
  await gh.putFile(`inbox/${jobId}.json`, JSON.stringify(job, null, 2), `Warteschlange: ${typ}-Link`);
  return job;
}

export async function addPhotoJob(base64Jpeg) {
  const jobId = makeJobId();
  await gh.putFile(`inbox/${jobId}.jpg`, base64Jpeg, `Warteschlange: Foto`, { isBase64: true });
  const job = { job_id: jobId, typ: 'foto', bild: `inbox/${jobId}.jpg`, status: 'wartet', erstellt_am: new Date().toISOString() };
  await gh.putFile(`inbox/${jobId}.json`, JSON.stringify(job, null, 2), `Warteschlange: Foto`);
  return job;
}

// ---------- Tags ----------

export function collectTags(recipes) {
  const counts = new Map();
  for (const r of recipes) {
    for (const t of r.tags || []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}
