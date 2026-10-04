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
    payload.browser && typeof payload.browser === 'object' ? payload.browser.cookies : null,
    payload.session && typeof payload.session === 'object' ? payload.session.cookies : null,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
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

function analyzeSession(cookies) {
  const names = new Set(cookies.map((c) => c.name.toLowerCase()));
  const present = SESSION_MARKERS.filter((n) => names.has(n));
  const hasSessionId = names.has('sessionid') || names.has('sessionid_ss');
  const hasSidTt = names.has('sid_tt');
  const hasUid = names.has('uid_tt') || names.has('uid_tt_ss');
  const hasGuard = names.has('sid_guard');
  const warnings = [];
  if (!hasSessionId && !hasSidTt) {
    warnings.push('Sem sessionid/sid_tt — login pode falhar ou cair ao doar. Peça cookies completos na LZT.');
  }
  if (!hasUid && hasSessionId) {
    warnings.push('Sem uid_tt — sessão pode ficar instável em ações sensíveis.');
  }
  if (present.length === 0) {
    warnings.push('Nenhum cookie de sessão TikTok reconhecido no payload.');
  }
  return { markersFound: present, hasSessionId, hasSidTt, hasUid, hasGuard, warnings };
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
  return expandHostKeys(rows);
}

const COOKIE_SCHEMA = `
CREATE TABLE meta (version INTEGER NOT NULL, version_changes TEXT);
CREATE TABLE hostaffinities (host_key TEXT NOT NULL PRIMARY KEY, affinity TEXT NOT NULL, last_updated INTEGER NOT NULL);
CREATE TABLE cookies (
  creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, name TEXT NOT NULL, value BLOB NOT NULL,
  path TEXT NOT NULL DEFAULT '/', expires_utc INTEGER NOT NULL DEFAULT 0,
  is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL DEFAULT 0, has_expires INTEGER NOT NULL DEFAULT 1,
  is_persistent INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 1,
  samesite INTEGER NOT NULL DEFAULT -1, source_scheme INTEGER NOT NULL DEFAULT 0,
  source_port INTEGER NOT NULL DEFAULT -1, source_type INTEGER NOT NULL DEFAULT 0,
  last_update_utc INTEGER NOT NULL DEFAULT 0, is_for_explicit_url INTEGER NOT NULL DEFAULT 0,
  encrypted_expires INTEGER NOT NULL, encrypted_value BLOB NOT NULL DEFAULT X'',
  encrypted_last_accessed INTEGER NOT NULL, encrypted_name BLOB NOT NULL DEFAULT X'',
  encrypted_value_type INTEGER NOT NULL DEFAULT 0,
  UNIQUE (host_key, path, name)
);
`;

function buildCookiesDb(cookies, file) {
  const db = new Database(file);
  db.pragma('journal_mode = MEMORY');
  db.exec(COOKIE_SCHEMA);
  db.prepare('INSERT INTO meta (version, version_changes) VALUES (2, ?)').run('74');
  const ins = db.prepare(`INSERT OR REPLACE INTO cookies (
    creation_utc, host_key, name, value, path, expires_utc, is_secure, is_httponly,
    last_accessed, has_expires, is_persistent, priority, samesite, source_scheme, source_port, source_type,
    last_update_utc, is_for_explicit_url, encrypted_expires, encrypted_value, encrypted_last_accessed,
    encrypted_name, encrypted_value_type
  ) VALUES (
    @createdCr, @hostKey, @name, @value, @path, @expiresCr, @secure, @httpOnly,
    @lastAccessedCr, @hasExpires, @isPersistent, 1, @samesite, 2, 443, 0,
    @lastAccessedCr, 0, 0, X'', 0, X'', 0
  )`);
  const tx = db.transaction((rows) => {
    for (const c of rows) {
      ins.run({
        createdCr: c.createdCr, hostKey: c.hostKey, name: c.name,
        value: Buffer.from(c.value, 'utf8'), path: c.path, expiresCr: c.expiresCr,
        secure: c.secure ? 1 : 0, httpOnly: c.httpOnly ? 1 : 0,
        lastAccessedCr: c.lastAccessedCr, hasExpires: c.hasExpires,
        isPersistent: c.isPersistent, samesite: c.samesite,
      });
    }
  });
  tx(cookies);
  const count = db.prepare('SELECT COUNT(*) AS n FROM cookies').get().n;
  db.close();
  return count;
}

function injectScript() {
  return `#!/system/bin/sh
set -e
PKG='${PKG}'
DIR='${WEBVIEW_DIR}'
NEW='${STAGED_DB}'
TS=$(date +%s 2>/dev/null || echo 0)
am force-stop "$PKG" 2>/dev/null || true
sleep 2
mkdir -p "$DIR" 2>/dev/null || true
if [ -f "$DIR/Cookies" ]; then
  mkdir -p '${BACKUP_DIR}'
  cp -f "$DIR/Cookies" '${BACKUP_DIR}/Cookies.bak_$TS' 2>/dev/null || true
fi
rm -f "$DIR/Cookies-journal" "$DIR/Cookies-wal" "$DIR/Cookies-shm" 2>/dev/null || true
rm -f "$DIR/Network Persistent State" 2>/dev/null || true
cp -f "$NEW" "$DIR/Cookies"
UID_APP=$(stat -c '%u' "/data/data/$PKG" 2>/dev/null || echo 1000)
GID_APP=$(stat -c '%g' "/data/data/$PKG" 2>/dev/null || echo 1000)
chown "$UID_APP:$GID_APP" "$DIR" "$DIR/Cookies" 2>/dev/null || true
chmod 700 "$DIR" 2>/dev/null || true
chmod 660 "$DIR/Cookies" 2>/dev/null || true
chcon u:object_r:app_data_file:s0 "$DIR/Cookies" 2>/dev/null || true
sync
if command -v sqlite3 >/dev/null 2>&1; then
  OK=$(sqlite3 "$DIR/Cookies" 'PRAGMA integrity_check;')
  [ "$OK" = "ok" ] || { echo "INJECT_FAIL integrity=$OK"; exit 1; }
  echo "ROWS=$(sqlite3 "$DIR/Cookies" 'SELECT count(*) FROM cookies;')"
fi
echo INJECT_OK
`;
}

async function sha256File(file) {
  const buf = await fsp.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function hydrateCookies(rawCookies, opts = {}) {
  const serial = opts.serial ?? process.env.ADB_SERIAL;
  const tag = serial ?? 'default';
  const cookies = normalizeCookies(rawCookies);
  const session = analyzeSession(cookies);
  log(tag, `payload valido: ${cookies.length} cookie(s); markers=${session.markersFound.join(',') || 'none'}`);
  for (const w of session.warnings) log(tag, `aviso: ${w}`);
  await assertRoot(serial, tag);
  try {
    const { out: pm } = await shell(serial, `pm path ${PKG}`);
    if (!/package:/.test(pm)) throw new Error(`TikTok (${PKG}) nao instalado neste aparelho`);
  } catch (e) {
    if (String(e.message).includes('nao instalado')) throw e;
    throw new Error(`TikTok (${PKG}) nao instalado neste aparelho`);
  }
  await shell(serial, `am force-stop ${PKG}`);
  log(tag, 'am force-stop');
  await sleep(2000);
  const localDb = path.join(os.tmpdir(), `musically_cookies_${process.pid}_${Date.now()}.db`);
  const count = buildCookiesDb(cookies, localDb);
  const localSum = await sha256File(localDb);
  const localSh = path.join(os.tmpdir(), `inject_${process.pid}_${Date.now()}.sh`);
  await fsp.writeFile(localSh, injectScript(), { mode: 0o755 });
  log(tag, `banco local (${count} linhas, sha=${localSum.slice(0, 12)})`);
  try {
    await shell(serial, `mkdir -p ${STAGE_DIR}`);
    await adb(serial, 'push', localDb, STAGED_DB);
    await adb(serial, 'push', localSh, STAGED_SH);
    const { out, err } = await shell(serial, `su 0 sh ${STAGED_SH}`, 120_000);
    if (out) log(tag, `script: ${out.split('\n').join(' | ')}`);
    if (!/INJECT_OK/.test(out)) throw new Error(`inject falhou (out=${out} err=${err})`);
    const { out: sumOut } = await shell(serial, `su 0 sha256sum ${DB_PATH}`);
    const remoteSum = sumOut.split(/\s+/)[0] ?? '';
    if (remoteSum !== localSum) throw new Error(`sha256 divergente local=${localSum} device=${remoteSum}`);
    log(tag, 'hash ok');
    const comp = await resolveLauncher(serial);
    const base = { ok: true, serial: tag, cookies: count, session, warnings: session.warnings };
    if (comp) {
      await shell(serial, `am start -n ${comp}`);
      return { ...base, launcher: comp };
    }
    await shell(serial, `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    return { ...base, launcher: '(monkey)' };
  } finally {
    await shell(serial, `rm -f ${STAGED_DB} ${STAGED_SH}`).catch(() => {});
    await fsp.rm(localDb, { force: true }).catch(() => {});
    await fsp.rm(localSh, { force: true }).catch(() => {});
  }
}

const locks = new Map();
function hydrateSerialGuarded(rawCookies, opts = {}) {
  const key = opts.serial ?? process.env.ADB_SERIAL ?? 'default';
  const prev = (locks.get(key) ?? Promise.resolve()).catch(() => {});
  const run = prev.then(() => hydrateCookies(rawCookies, opts));
  locks.set(key, run);
  return run;
}

async function main() {
  const [file, serial] = process.argv.slice(2);
  if (!file) {
    console.error('uso: node cookie-hydrator.js <cookies.json|txt> [serial-adb]');
    process.exit(2);
  }
  const text = fsSync.readFileSync(file, 'utf8');
  let raw;
  try { raw = JSON.parse(text); } catch { raw = text; }
  const res = await hydrateCookies(raw, { serial });
  console.log(JSON.stringify(res, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
}

module.exports = {
  hydrateCookies,
  hydrateSerialGuarded,
  normalizeCookies,
  parseRawCookies,
  analyzeSession,
  PKG,
};
