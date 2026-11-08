'use strict';
// Usage: npm run invite -- 媽媽 [https://album.example.com]
const crypto = require('node:crypto');
const name = (process.argv[2] || '').replace(/[|,]/g, '').trim();
if (!name) { console.error('Usage: npm run invite -- <name> [base-url]'); process.exit(1); }
const base = (process.argv[3] || 'https://album.example.com').replace(/\/$/, '');
const token = crypto.randomBytes(24).toString('base64url');
console.log(`Add to INVITES in .env (comma-separated):\n  ${name}|${token}\n\nSend this link to ${name}:\n  ${base}/i/${token}`);
