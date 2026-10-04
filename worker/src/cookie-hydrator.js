/**
 * worker/cookie-hydrator.js
 *
 * Raw cookie hydration into TikTok WebView SQLite via ADB + root.
 * Accepts JSON array/object (LZT Market), Netscape file, or name=value lines.
 * Dependencia: better-sqlite3
 */
'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const pExecFile = promisify(execFile);

const ADB         = process.env.ADB_BIN    ?? 'adb';
const PKG         = process.env.TIKTOK_PKG ?? 'com.zhiliaoapp.musically';
const WEBVIEW_DIR = `/data/data/${PKG}/app_webview/Default`;
const DB_PATH     = `${WEBVIEW_DIR}/Cookies`;
const STAGE_DIR   = '/data/local/tmp/cookie_hydration';
const STAGED_DB   = `${STAGE_DIR}/Cookies.new`;
const STAGED_SH   = `${STAGE_DIR}/inject.sh`;
const BACKUP_DIR  = '/data/local/tmp/cookie_hydration_backups';
const ADB_TIMEOUT = 90_000;

const CR_DELTA_US = 11_644_473_600_000_000n;
const crFromUnix = (s) => BigInt(Math.trunc(s)) * 1_000_000n + CR_DELTA_US;
const crNow      = ()  => BigInt(Math.floor(Date.now() / 1000)) * 1_000_000n + CR_DELTA_US;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log   = (tag, msg) => console.log(`[${new Date().toISOString()}][${tag}] ${msg}`);

const SESSION_MARKERS = [
  'sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'uid_tt_ss', 'sid_guard',
];

const adbArgs = (serial, ...args) => (serial ? ['-s', serial, ...args] : args);

async function adb(serial, ...args) {
  const { stdout, stderr } = await pExecFile(ADB, adbArgs(serial, ...args), {
    timeout: ADB_TIMEOUT, maxBuffer: 8 * 1024 * 1024,
  });
  return { out: stdout.trim(), err: stderr.trim() };
}

async function shell(serial, cmd, timeout = ADB_TIMEOUT) {
  const { stdout, stderr } = await pExecFile(ADB, adbArgs(serial, 'shell', cmd), {
    timeout, maxBuffer: 8 * 1024 * 1024,
  });
  return { out: stdout.trim(), err: stderr.trim() };
}

async function assertRoot(serial, tag) {
  try {
    const { out } = await shell(serial, 'su 0 id');
    if (!/uid=0/.test(out)) throw new Error(`saida inesperada: ${out || '(vazia)'}`);
  } catch (e) {
    throw new Error(`[${tag}] root indisponivel ("su 0 id" falhou): ${e.message}`);
  }
}

async function resolveLauncher(serial) {
  try {
    const { out } = await shell(serial, `cmd package resolve-activity --brief ${PKG}`);
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith(PKG) && lines[i].includes('/')) return lines[i];
    }
  } catch { /* monkey fallback */ }
  return null;
}

const SAME_SITE = { unspecified: -1, none: 0, no_restriction: 0, lax: 1, strict: 2 };

function parseCookieString(str, i) {
  const obj = {};
  for (const part of String(str).split(';')) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) {
      const flag = t.toLowerCase();
      if (flag === 'secure') obj.secure = true;
      if (flag === 'httponly') obj.httponly = true;
      continue;
    }
    const k = t.slice(0, eq).trim().toLowerCase();
    obj[k] = t.slice(eq + 1).trim();
  }
  if (!obj.name && Object.keys(obj).length) {
    const first = String(str).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) {
      obj.name = first.slice(0, eq).trim();
      obj.value = first.slice(eq + 1).trim();
    }
  }
  if (!obj.name) throw new Error(`cookie #${i}: string incompleta`);
  for (const k of ['secure', 'httponly']) {
    if (obj[k] != null && typeof obj[k] !== 'boolean') {
      obj[k] = !['false', '0', ''].includes(String(obj[k]).toLowerCase());
    }
  }
  return obj;
}

function parseNetscapeLine(line, i) {
  const parts = line.split('\t');
  if (parts.length < 7) throw new Error(`cookie #${i}: Netscape incompleto`);
  const [domainRaw, , pathRaw, secureRaw, expiresRaw, name, value] = parts;
  const domain = String(domainRaw || '').trim();
  if (!name || !domain) throw new Error(`cookie #${i}: name/domain ausentes`);
  const expires = Number(expiresRaw);
  return {
    name: String(name).trim(),
    value: value != null ? String(value) : '',
    domain,
    path: String(pathRaw || '/').trim() || '/',
    secure: String(secureRaw).toUpperCase() === 'TRUE',
    httpOnly: false,
    expirationDate: Number.isFinite(expires) && expires > 0 ? expires : 0,
    hostOnly: !domain.startsWith('.'),
  };
}

function extractCookieArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.cookies, payload.Cookies,
    payload.data && typeof payload.data === 'object' ? payload.data.cookies : null,
    payload.profile && typeof payload.profile === 'object' ? payload.profile.cookies : null,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  return null;
}

function parseRawCookies(raw) {
  if (raw == null) throw new Error('payload: cookies ausentes');
  if (Array.isArray(raw)) {
    if (!raw.length) throw new Error('payload: array de cookies vazio');
    return raw;
  }
  if (typeof raw === 'object') {
    const arr = extractCookieArray(raw);
    if (arr && arr.length) return arr;
    throw new Error('payload: objeto sem array cookies');
  }
  if (typeof raw !== 'string') throw new Error('payload: tipo nao suportado');
  const text = raw.trim();
  if (!text) throw new Error('payload: texto vazio');
  if (text.startsWith('[') || text.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error(`payload: JSON invalido (${e.message})`); }
    return parseRawCookies(parsed);
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('payload: nenhuma linha valida');
  if (lines.some((l) => l.split('\t').length >= 7)) {
    return lines.filter((l) => l.split('\t').length >= 7).map((l, i) => parseNetscapeLine(l, i));
  }
  return lines.map((l, i) => parseCookieString(l, i));
}

function resolveHostKey(obj, name, i) {
  const domainRaw = String(obj.domain ?? obj.host ?? '').trim().toLowerCase();
  const hadLeadingDot = domainRaw.startsWith('.');
  const domain = domainRaw.replace(/^\./, '').replace(/\.+$/, '');
  if (!domain) throw new Error(`cookie #${i} (${name}): domain ausente`);
  const hostOnly = hadLeadingDot ? false : Boolean(obj.hostOnly ?? obj.hostonly ?? false);
  const hostKey = hostOnly ? domain : `.${domain}`;
  return { domain, hostOnly, hostKey };
}

function analyzeSession(cookies, meta = {}) {
  const names = new Set(cookies.map((c) => c.name.toLowerCase()));
  const present = SESSION_MARKERS.filter((n) => names.has(n));
  const hasSessionId = names.has('sessionid') || names.has('sessionid_ss');
  const hasSidTt = names.has('sid_tt');
  const hasUid = names.has('uid_tt') || names.has('uid_tt_ss');
  const hasGuard = names.has('sid_guard');
  const warnings = [];
  if (meta.derivedFromGuard) {
    warnings.push(
      'Pacote LZT minimo: sessionid/sid_tt derivados de sid_guard (heuristica). Doacao pode falhar — teste 1 presente logo apos hidratar.',
    );
  } else if (!hasSessionId && !hasSidTt) {
    warnings.push('Sem sessionid/sid_tt — login pode falhar ou cair ao doar. Pacote incompleto da LZT.');
  }
  if (!hasUid && (hasSessionId || meta.derivedFromGuard)) {
    warnings.push('Sem uid_tt — sessao pode ficar instavel em acoes sensiveis (presente/follow).');
  }
  if (present.length === 0 && !meta.derivedFromGuard) {
    warnings.push('Nenhum cookie de sessao TikTok reconhecido no payload.');
  }
  return {
    markersFound: present,
    hasSessionId,
    hasSidTt,
    hasUid,
    hasGuard,
    derivedFromGuard: Boolean(meta.derivedFromGuard),
    warnings,
  };
}

function expandHostKeys(rows) {
  const out = [];
  const seen = new Set();
  const keyOf = (c) => `${c.hostKey}\0${c.path}\0${c.name}`;
  for (const c of rows) {
    if (!seen.has(keyOf(c))) {
      seen.add(keyOf(c));
      out.push(c);
    }
    const bare = c.hostKey.replace(/^\./, '');
    if (bare === 'tiktok.com' || bare === 'tiktokv.com' || bare.endsWith('.tiktok.com')) {
      const altKey = c.hostKey.startsWith('.') ? bare : `.${bare}`;
      const alt = { ...c, hostKey: altKey };
      if (!seen.has(keyOf(alt))) {
        seen.add(keyOf(alt));
        out.push(alt);
      }
    }
  }
  return out;
}

/**
 * LZT minimal packs often only ship sid_guard + msToken.
 * sid_guard value is typically: token|unix|ttl|expiryText (URL-encoded).
 * When sessionid/sid_tt are missing, derive them from the guard token so the
 * WebView has the cookie names the app looks up. Not a guarantee — only a best-effort.
 */
function deriveFromSidGuard(rows) {
  const names = new Set(rows.map((c) => c.name.toLowerCase()));
  const hasSessionId = names.has('sessionid') || names.has('sessionid_ss');
  const hasSidTt = names.has('sid_tt');
  if (hasSessionId && hasSidTt) {
    return { rows, derived: false, token: null };
  }
  const guard = rows.find((c) => c.name.toLowerCase() === 'sid_guard' && c.value);
  if (!guard) {
    return { rows, derived: false, token: null };
  }
  let raw = String(guard.value);
  try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
  const token = raw.split('|')[0].trim();
  if (!token || token.length < 8) {
    return { rows, derived: false, token: null };
  }
  const template = {
    hostKey: guard.hostKey,
    path: guard.path || '/',
    secure: true,
    httpOnly: false,
    hasExpires: guard.hasExpires ?? 1,
    isPersistent: 1,
    expiresCr: guard.expiresCr,
    samesite: guard.samesite ?? -1,
    createdCr: guard.createdCr,
    lastAccessedCr: guard.lastAccessedCr,
  };
  const out = [...rows];
  if (!hasSessionId) {
    out.push({ ...template, name: 'sessionid', value: token });
    out.push({ ...template, name: 'sessionid_ss', value: token });
  }
  if (!hasSidTt) {
    out.push({ ...template, name: 'sid_tt', value: token });
  }
  return { rows: out, derived: true, token: token.slice(0, 8) + '…' };
}

function normalizeCookies(raw) {
  const list = parseRawCookies(raw);
  const nowCr = crNow();
  const rows = list.map((c, i) => {
    const obj = typeof c === 'string' ? parseCookieString(c, i) : c;
    const name = String(obj?.name ?? '').trim();
    if (!name) throw new Error(`cookie #${i}: name ausente`);
    const value = obj.value != null ? String(obj.value) : '';
    const { hostKey } = resolveHostKey(obj, name, i);
    const exp = Number(obj.expirationDate ?? obj.expires ?? 0);
    const hasExp = Number.isFinite(exp) && exp > 0;
    const samesite = typeof obj.sameSite === 'number' || typeof obj.samesite === 'number'
      ? Number(obj.sameSite ?? obj.samesite)
      : (SAME_SITE[String(obj.sameSite ?? obj.samesite ?? 'unspecified').toLowerCase()] ?? -1);
    return {
      name, value, hostKey,
      path: String(obj.path ?? '/').trim() || '/',
      secure: obj.secure != null ? Boolean(obj.secure) : true,
      httpOnly: Boolean(obj.httpOnly ?? obj.httponly ?? false),
      hasExpires: 1,
      isPersistent: 1,
      expiresCr: hasExp ? crFromUnix(exp) : crFromUnix(2147483647),
      samesite, createdCr: nowCr, lastAccessedCr: nowCr,
    };
  });
  const { rows: withDerived, derived } = deriveFromSidGuard(rows);
  const expanded = expandHostKeys(withDerived);
  expanded._meta = { derivedFromGuard: derived };
  return expanded;
}
