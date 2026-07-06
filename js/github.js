// GitHub-Anbindung — liest und schreibt das private Daten-Repo
// über die Contents-API. Token kommt aus den App-Einstellungen (localStorage).

const API = 'https://api.github.com';

export function getConfig() {
  return {
    token: localStorage.getItem('gh_token') || '',
    repo: localStorage.getItem('gh_repo') || '',
  };
}

export function saveConfig(token, repo) {
  localStorage.setItem('gh_token', token.trim());
  localStorage.setItem('gh_repo', repo.trim());
}

export function clearConfig() {
  localStorage.removeItem('gh_token');
  localStorage.removeItem('gh_repo');
}

async function gh(path, opts = {}) {
  const { token, repo } = getConfig();
  const res = await fetch(`${API}/repos/${repo}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`GitHub ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function fetchRaw(path) {
  return gh(`contents/${encodeURI(path)}?t=${Date.now()}`, {
    headers: { Accept: 'application/vnd.github.raw' },
  });
}

export async function fetchJson(path) {
  const res = await fetchRaw(path);
  return res.json();
}

export async function getSha(path) {
  try {
    const res = await gh(`contents/${encodeURI(path)}?t=${Date.now()}`);
    const data = await res.json();
    return data.sha;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function putFile(path, content, message, { isBase64 = false } = {}) {
  const sha = await getSha(path);
  const body = {
    message,
    content: isBase64 ? content : b64encodeUtf8(content),
  };
  if (sha) body.sha = sha;
  const res = await gh(`contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function listDir(path) {
  try {
    const res = await gh(`contents/${encodeURI(path)}?t=${Date.now()}`);
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

export async function testConnection() {
  const { token, repo } = getConfig();
  if (!token || !repo) throw new Error('Token oder Repo fehlt');
  const res = await fetch(`${API}/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 401) throw new Error('Token ungültig oder abgelaufen');
  if (res.status === 404) throw new Error('Repo nicht gefunden — Schreibweise prüfen (z. B. InnerImpact/rezepte-daten) und ob der Token dieses Repo darf');
  if (!res.ok) throw new Error(`GitHub antwortet mit Fehler ${res.status}`);
  return res.json();
}
