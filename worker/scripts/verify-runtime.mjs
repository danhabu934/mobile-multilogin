import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const major = Number(process.versions.node.split('.')[0])
if (major < 22) throw new Error('Node.js 22+ is required')
// The locked SQLite package ships native binaries; verify the binary before reporting installation success.
const Database = require('better-sqlite3')
const db = new Database(':memory:')
try { if (db.prepare('select 1 as ok').get().ok !== 1) throw new Error('SQLite runtime verification failed') }
finally { db.close() }
console.log('Node and SQLite runtime verified')
