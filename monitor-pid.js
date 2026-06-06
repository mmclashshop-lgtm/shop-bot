const { execSync } = require('child_process');

const TARGET_PID = parseInt(process.argv[2], 10);
if (!TARGET_PID) {
  console.error('Usage: node monitor-pid.js <PID>');
  process.exit(1);
}

console.log(`Monitoring PID ${TARGET_PID}...`);

const memInterval = setInterval(() => {
  try {
    const result = execSync(`tasklist /FI "PID eq ${TARGET_PID}" /FO CSV`, { encoding: 'utf8', timeout: 2000 });
    const lines = result.trim().split('\r\n');
    if (lines.length > 1) {
      const cols = lines[1].split(',');
      const memStr = cols[4].replace(/"/g, '').trim();
      const memKB = parseInt(memStr.replace(/,/g, ''), 10);
      if (!isNaN(memKB) && memKB > 0) {
        const wsStr = cols[5].replace(/"/g, '').trim();
        const wsKB = parseInt(wsStr.replace(/,/g, ''), 10);
        console.log(JSON.stringify({ 
          timestamp: Date.now(),
          pid: TARGET_PID,
          memMB: Math.round(memKB / 1024),
          wsMB: Math.round(wsKB / 1024)
        }));
      }
    }
  } catch(e) {
    console.log('[MEM ERR]', e.message);
  }
}, 10000);

setTimeout(() => {
  clearInterval(memInterval);
  console.log('MONITORING_COMPLETE');
}, 600000); // 10 minutes