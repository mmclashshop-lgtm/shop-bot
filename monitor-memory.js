const { spawn, execSync } = require('child_process');

const bot = spawn('cmd', ['/c', 'node', 'src/index.js'], { 
  cwd: 'C:\\Users\\konok\\OneDrive\\Desktop\\free bots\\shop bot',
  windowsHide: false
});

bot.stdout.on('data', (data) => { 
  console.log('[BOT OUT]', data.toString().trim());
});
bot.stderr.on('data', (data) => { 
  console.error('[BOT ERR]', data.toString().trim());
});

bot.on('exit', (code, signal) => {
  console.log('[BOT EXIT]', code, signal);
});

const memInterval = setInterval(() => {
  try {
    const result = execSync(`tasklist /FI "PID eq ${bot.pid}" /FO CSV`, { encoding: 'utf8', timeout: 2000 });
    const lines = result.trim().split('\r\n');
    if (lines.length > 1) {
      const cols = lines[1].split(',');
      const memStr = cols[4].replace(/"/g, '').trim();
      const memKB = parseInt(memStr.replace(/,/g, ''), 10);
      if (!isNaN(memKB) && memKB > 0) {
        console.log(JSON.stringify({ 
          timestamp: Date.now(),
          pid: bot.pid,
          memMB: Math.round(memKB / 1024)
        }));
      }
    }
  } catch(e) {
    console.log('[MEM ERR]', e.message);
  }
}, 5000);

setTimeout(() => {
  clearInterval(memInterval);
  bot.kill();
  console.log('MONITORING_COMPLETE');
}, 300000); // 5 minutes