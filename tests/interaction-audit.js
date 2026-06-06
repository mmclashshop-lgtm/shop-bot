/**
 * Interaction Regression Test v3 — Full State Machine Audit
 */
const fs = require('fs');
const path = require('path');

async function analyzeFile(filePath) {
  const errors = [];
  let mod;
  try { mod = require(filePath); } catch (e) {
    return [{ type: 'LOAD_ERR', detail: e.message, line: 0, status: 'FAIL' }];
  }
  const relPath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
  const handlers = ['execute', 'handleButton', 'handleSelectMenu', 'handleModalSubmit'];

  for (const handler of handlers) {
    if (typeof mod[handler] !== 'function') continue;
    const src = mod[handler].toString();
    const lines = src.split('\n');
    let acked = false, inBlock = false;
    let asyncLineBeforeAck = -1;

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith('/*')) inBlock = true;
      if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
      if (t.startsWith('//') || t === '' || t === '{' || t === '}') continue;

      const isAck = /interaction\.(deferReply|deferUpdate|reply|showModal|update)\s*\(/.test(t);
      const isEdit = /interaction\.editReply\s*\(/.test(t);
      const isAsync = /await\s+(?!interaction\.)/.test(t) && !/await\s+interaction\.\w+/.test(t);
      const isReturn = /^\s*return\s+/.test(t);

      if (isAck && !acked) acked = true;
      if (isEdit && !acked && !isReturn) {
        // Check if unreachable after return
        const prev = i > 0 ? lines[i-1].trim() : '';
        if (!prev.startsWith('return ')) {
          errors.push({ type: 'editReplyWithoutAck', handler, file: relPath, line: i+1,
            detail: `editReply() without prior deferReply/deferUpdate/reply/showModal`, status: 'FAIL' });
        }
      }
      if (isAsync && !acked && asyncLineBeforeAck < 0) asyncLineBeforeAck = i+1;
    }

    if (asyncLineBeforeAck > 0) {
      errors.push({ type: 'ASYNC_BEFORE_ACK', handler, file: relPath, line: asyncLineBeforeAck,
        detail: `Async work starts at line ${asyncLineBeforeAck}, ACK happens later. Risk of 3s timeout.`, status: 'WARN' });
    }
  }
  return errors;
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  INTERACTION REGRESSION — Full State Machine Audit             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log('  File                                    Handlers          Result   Issues');
  console.log('  ' + '─'.repeat(78));

  const dir = path.join(__dirname, '../src/commands');
  const files = [];
  for (const cat of fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory()))
    for (const f of fs.readdirSync(path.join(dir, cat)).filter(f => f.endsWith('.js')))
      files.push(path.join(dir, cat, f));
  files.push(path.join(__dirname, '../src/events/interactionCreate.js'));
  files.push(path.join(__dirname, '../src/handlers/commandHandler.js'));

  const all = [];
  let p=0, w=0, f=0;

  for (const fp of files) {
    const errs = await analyzeFile(fp);
    const rp = path.relative(path.join(__dirname, '..'), fp).replace(/\\/g, '/');
    let mod2;
    try { mod2 = require(fp); } catch { mod2 = {}; }
    const hh = ['execute','handleButton','handleSelectMenu','handleModalSubmit'].filter(h => typeof mod2[h] === 'function').join(',');
    const fails = errs.filter(e => e.status === 'FAIL');
    const warns = errs.filter(e => e.status === 'WARN');
    if (fails.length) { f++; console.log(`  ❌ FAIL  ${rp.padEnd(37)} ${hh.padEnd(16)} ${fails.length + warns.length}`); }
    else if (warns.length) { w++; console.log(`  ⚠️ WARN  ${rp.padEnd(37)} ${hh.padEnd(16)} ${warns.length}`); }
    else { p++; console.log(`  ✅ PASS  ${rp.padEnd(37)} ${hh.padEnd(16)} 0`); }
    for (const e of errs) all.push(e);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  DETAILS');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  for (const e of all) {
    const icon = e.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${e.file} → ${e.handler} (L${e.line})`);
    console.log(`    ${e.detail}\n`);
  }
  
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SCORE: ' + `PASS=${p}  WARN=${w}  FAIL=${f}`.padStart(47));
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  process.exit(f > 0 ? 1 : 0);
})();
