/**
 * worker/cookie-hydrator.js
 * Cookie hydration into TikTok WebView + Chrome SQLite via ADB root.
 * Accepts LZT JSON array/object, Netscape, or name=value lines.
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

const ADB = process.env.ADB_BIN ?? 'adb';
const PKG = process.env.TIKTOK_PKG ?? 'com.zhiliaoapp.musically';
const CHROME_PKG = process.env.CHROME_PKG ?? 'com.android.chrome';
const WEBVIEW_DIR = `/data/data/${PKG}/app_webview/Default`;
const CHROME_DIR = `/data/data/${CHROME_PKG}/app_chrome/Default`;
const STAGE_DIR = '/data/local/tmp/cookie_hydration';
const BACKUP_DIR = '/data/local/tmp/cookie_hydration_backups';
const ADB_TIMEOUT = 90_000;

const CR_DELTA_US = 11_644_473_600_000_000n;
const crFromUnix = (s) => BigInt(Math.trunc(s)) * 1_000_000n + CR_DELTA_US;
const crNow = () => BigInt(Math.floor(Date.now() / 1000)) * 1_000_000n + CR_DELTA_US;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, msg) => console.log(`[${new Date().toISOString()}][${tag}] ${msg}`);

const SESSION_MARKERS = ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'uid_tt_ss', 'sid_guard'];
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
    try {
      await adb(serial, 'root');
      await sleep(800);
      const { out } = await shell(serial, 'id');
      if (/uid=0/.test(out)) return;
    } catch { /* ignore */ }
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
  if (!obj.name) throw new Error(`cookie string #${i}: name ausente`);
  return obj;
}

function parseNetscapeLine(line, i) {
  const parts = line.split('\t');
  if (parts.length < 7) throw new Error(`netscape #${i}: colunas insuficientes`);
  const [domainRaw, , pathRaw, secureRaw, expiresRaw, name, value] = parts;
  return {
    domain: String(domainRaw || '').trim(),
    path: String(pathRaw || '/').trim() || '/',
    secure: String(secureRaw || '').toUpperCase() === 'TRUE',
    expirationDate: Number(expiresRaw) || 0,
    name: String(name || '').trim(),
    value: value != null ? String(value) : '',
  };
}

function extractCookieArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of [
      payload.cookies, payload.Cookies,
      payload.data && payload.data.cookies,
    ]) {
      if (Array.isArray(key)) return key;
    }
  }
  return null;
}

function parseRawCookies(raw) {
  if (Array.isArray(raw)) {
    if (!raw.length) throw new Error('payload: array de cookies vazio');
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const arr = extractCookieArray(raw);
    if (arr) return arr;
    throw new Error('payload: objeto sem array cookies');
  }
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('payload: cookies vazios');
  try {
    const parsed = JSON.parse(text);
    return parseRawCookies(parsed);
  } catch {
    /* not JSON */
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('payload: nenhuma linha de cookie');
  if (lines[0].split('\t').length >= 7) return lines.map((l, i) => parseNetscapeLine(l, i));
  return lines.map((l, i) => parseCookieString(l, i));
}

function resolveHostKey(obj, name, i) {
  let host = String(obj.domain ?? obj.host ?? obj.hostKey ?? obj.host_key ?? '').trim();
  if (!host) host = '.tiktok.com';
  if (obj.hostOnly === true && host.startsWith('.')) host = host.slice(1);
  if (obj.hostOnly === false && host && !host.startsWith('.')) host = `.${host}`;
  if (!host) throw new Error(`cookie ${name}#${i}: domain ausente`);
  return { hostKey: host };
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
    hasSessionId, hasSidTt, hasUid, hasGuard,
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

function deriveFromSidGuard(rows) {
  const names = new Set(rows.map((c) => c.name.toLowerCase()));
  const hasSessionId = names.has('sessionid') || names.has('sessionid_ss');
  const hasSidTt = names.has('sid_tt');
  if (hasSessionId && hasSidTt) return { rows, derived: false };
  const guard = rows.find((c) => c.name.toLowerCase() === 'sid_guard' && c.value);
  if (!guard) return { rows, derived: false };
  let raw = String(guard.value);
  try { raw = decodeURIComponent(raw); } catch { /* keep */ }
  const token = raw.split('|')[0].trim();
  if (!token || token.length < 8) return { rows, derived: false };
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
  if (!hasSidTt) out.push({ ...template, name: 'sid_tt', value: token });
  return { rows: out, derived: true };
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

function injectScript(pkg, dir, stagedDb) {
  return `#!/system/bin/sh
set -e
PKG='${pkg}'
DIR='${dir}'
NEW='${stagedDb}'
TS=$(date +%s 2>/dev/null || echo 0)
am force-stop "$PKG" 2>/dev/null || true
sleep 1
mkdir -p "$DIR" 2>/dev/null || true
if [ -f "$DIR/Cookies" ]; then
  mkdir -p '${BACKUP_DIR}'
  cp -f "$DIR/Cookies" '${BACKUP_DIR}/Cookies_${pkg}_$TS' 2>/dev/null || true
fi
rm -f "$DIR/Cookies-journal" "$DIR/Cookies-wal" "$DIR/Cookies-shm" 2>/dev/null || true
cp -f "$NEW" "$DIR/Cookies"
UID_APP=$(stat -c '%u' "/data/data/$PKG" 2>/dev/null || stat -c '%u' "$DIR" 2>/dev/null || echo 1000)
GID_APP=$(stat -c '%g' "/data/data/$PKG" 2>/dev/null || stat -c '%g' "$DIR" 2>/dev/null || echo 1000)
chown "$UID_APP:$GID_APP" "$DIR/Cookies" 2>/dev/null || true
chmod 660 "$DIR/Cookies" 2>/dev/null || true
chcon u:object_r:app_data_file:s0 "$DIR/Cookies" 2>/dev/null || true
sync
echo INJECT_OK_$PKG
`;
}

async function sha256File(file) {
  const buf = await fsp.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function injectIntoTarget(serial, tag, cookies, pkg, dir, label) {
  const localDb = path.join(os.tmpdir(), `cookies_${label}_${process.pid}_${Date.now()}.db`);
  const stagedDb = `${STAGE_DIR}/Cookies.${label}.new`;
  const stagedSh = `${STAGE_DIR}/inject_${label}.sh`;
  const count = buildCookiesDb(cookies, localDb);
  const localSh = path.join(os.tmpdir(), `inject_${label}_${process.pid}.sh`);
  await fsp.writeFile(localSh, injectScript(pkg, dir, stagedDb), { mode: 0o755 });
  try {
    const { out: exists } = await shell(serial, `su 0 test -d /data/data/${pkg} && echo YES || echo NO`);
    if (!/YES/.test(exists)) {
      log(tag, `${label}: pacote ${pkg} nao instalado — pulando`);
      return { ok: false, skipped: true, reason: `${pkg} nao instalado`, cookies: 0, target: pkg };
    }
    await shell(serial, `su 0 mkdir -p ${dir}`);
    await shell(serial, `mkdir -p ${STAGE_DIR}`);
    await adb(serial, 'push', localDb, stagedDb);
    await adb(serial, 'push', localSh, stagedSh);
    const { out, err } = await shell(serial, `su 0 sh ${stagedSh}`, 120_000);
    if (out) log(tag, `${label}: ${out.split('\n').join(' | ')}`);
    if (!new RegExp(`INJECT_OK_${pkg.replace(/\./g, '\\.')}`).test(out) && !/INJECT_OK/.test(out)) {
      throw new Error(`${label} inject falhou (out=${out} err=${err})`);
    }
    log(tag, `${label}: ${count} cookies injetados em ${pkg}`);
    return { ok: true, cookies: count, target: pkg };
  } finally {
    await shell(serial, `rm -f ${stagedDb} ${stagedSh}`).catch(() => {});
    await fsp.rm(localDb, { force: true }).catch(() => {});
    await fsp.rm(localSh, { force: true }).catch(() => {});
  }
}

async function hydrateCookies(rawCookies, opts = {}) {
  const serial = opts.serial ?? process.env.ADB_SERIAL ?? null;
  const tag = serial || 'default';
  await assertRoot(serial, tag);
  const cookies = normalizeCookies(rawCookies);
  const meta = cookies._meta || {};
  const session = analyzeSession(cookies, meta);
  if (meta.derivedFromGuard) log(tag, 'heuristica: sessionid/sid_tt derivados de sid_guard');
  log(tag, `payload valido: ${cookies.length} cookie(s); markers=${session.markersFound.join(',') || 'nenhum'}`);
  for (const w of session.warnings) log(tag, `aviso: ${w}`);

  const targets = [
    { pkg: PKG, dir: WEBVIEW_DIR, label: 'tiktok' },
    { pkg: CHROME_PKG, dir: CHROME_DIR, label: 'chrome' },
  ];
  const results = [];
  for (const t of targets) {
    try {
      results.push(await injectIntoTarget(serial, tag, cookies, t.pkg, t.dir, t.label));
    } catch (e) {
      log(tag, `${t.label} ERRO: ${e.message}`);
      results.push({ ok: false, target: t.pkg, error: e.message, cookies: 0 });
    }
  }

  const chrome = results.find((r) => r.target === CHROME_PKG);

  let launcher = null;
  if (results.some((r) => r.ok && r.target === PKG)) {
    const comp = await resolveLauncher(serial);
    if (comp) {
      await shell(serial, `am start -n ${comp}`);
      launcher = comp;
    } else {
      await shell(serial, `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
      launcher = '(monkey)';
    }
  }

  const totalCookies = Math.max(0, ...results.filter((r) => r.ok).map((r) => r.cookies));
  const warnings = [...session.warnings];
  if (chrome && chrome.skipped) warnings.push('Chrome nao instalado no emulador — so TikTok recebeu cookies.');
  if (chrome && chrome.error) warnings.push(`Chrome: ${chrome.error}`);
  if (chrome && chrome.ok) warnings.push('Cookies tambem injetados no Chrome (tiktok.com). Abra https://www.tiktok.com no Chrome.');

  return {
    ok: results.some((r) => r.ok),
    serial: tag,
    cookies: totalCookies,
    launcher,
    targets: results,
    warnings,
  };
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

module.exports = { hydrateCookies, hydrateSerialGuarded, normalizeCookies, parseRawCookies, PKG, CHROME_PKG };
