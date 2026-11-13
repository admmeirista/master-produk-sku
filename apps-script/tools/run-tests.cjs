// Expand test files explicitly: Node 20 does not expand quoted glob arguments.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = path.resolve(__dirname, '../test');
const files = fs.readdirSync(directory).filter(name => name.endsWith('.test.cjs')).sort();
if (!files.length) throw new Error('Tidak ada file pengujian ditemukan');
const result = spawnSync(process.execPath, ['--test', ...files.map(name => path.join(directory, name))], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
