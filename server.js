const express = require('express');
const cors = require('cors');

// ═══════════════════════════════════════════════════════════
//  IVAC CAPTCHA TOKEN SERVER v3.0
// ═══════════════════════════════════════════════════════════

const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY || 'riadtoken';
const TOKEN_MAX_AGE = 200;

const tokenPool = [];
let solverCommand = 'none';

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// Auth
function auth(req, res, next) {
    const key = req.headers['x-api-key'] || req.body?.apiKey || req.query?.apiKey;
    if (key !== API_KEY) return res.status(401).json({ error: 'INVALID API KEY' });
    next();
}

// Cleanup expired tokens every 15 seconds
setInterval(() => {
    const cutoff = Date.now() - (TOKEN_MAX_AGE * 1000);
    for (let i = tokenPool.length - 1; i >= 0; i--) {
        if (tokenPool[i].timestamp < cutoff) tokenPool.splice(i, 1);
    }
}, 15000);

// ═══════════════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Store token — solver pushes on top
app.post('/storeToken', auth, (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'MISSING TOKEN' });
        tokenPool.push({ token: token.trim(), timestamp: Date.now() });
        res.json({ success: true, pool_size: tokenPool.length });
    } catch (e) {
        res.status(500).json({ error: 'SERVER ERROR' });
    }
});

// Get token — python picks from top (newest, most life)
app.get('/getToken', auth, (req, res) => {
    try {
        if (tokenPool.length === 0) return res.json({ success: false, error: 'NO TOKENS AVAILABLE' });
        const entry = tokenPool.pop();
        const age = Math.round((Date.now() - entry.timestamp) / 1000);
        res.json({ success: true, token: entry.token, age: age, remaining_life: TOKEN_MAX_AGE - age });
    } catch (e) {
        res.status(500).json({ error: 'SERVER ERROR' });
    }
});

// Status — just pool size and solver command
app.get('/status', auth, (req, res) => {
    res.json({ pool_size: tokenPool.length, solver_command: solverCommand });
});

// Remote control
app.get('/solverStart', auth, (req, res) => {
    solverCommand = 'start';
    res.json({ success: true, command: 'start' });
});

app.get('/solverStop', auth, (req, res) => {
    solverCommand = 'stop';
    res.json({ success: true, command: 'stop' });
});

// Health — keep alive for UptimeRobot
app.get('/health', (req, res) => {
    res.json({ status: 'ok', pool: tokenPool.length });
});

// Dashboard — pool + solver status + start/stop + command log
app.get('/dashboard', (req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>IVAC Token Server</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#e0e0e0;font-family:'Consolas',monospace;display:flex;flex-direction:column;align-items:center;padding:30px;min-height:100vh}h1{color:#00ff88;margin-bottom:25px;font-size:18px}.stats{display:flex;gap:15px;margin-bottom:25px}.stat-box{background:#0f0f23;border:2px solid #333;border-radius:12px;padding:20px 30px;text-align:center;min-width:140px}.stat-box.active{border-color:#00ff88}.stat-num{font-size:48px;font-weight:bold;line-height:1;color:#00ff88}.stat-label{color:#888;font-size:11px;text-transform:uppercase;margin-top:6px}.solver-status{font-size:24px;font-weight:bold;line-height:1}.solver-start{color:#00ff88}.solver-stop{color:#ff4444}.solver-none{color:#888}.btns{display:flex;gap:12px;margin-bottom:20px}button{border:none;padding:12px 30px;border-radius:6px;font-family:inherit;font-size:14px;font-weight:bold;cursor:pointer}button:hover{opacity:0.9}.btn-green{background:#00ff88;color:#0f0f23}.btn-red{background:#ff4444;color:#fff}#log{background:#0f0f23;border:1px solid #333;border-radius:8px;padding:10px 12px;width:100%;max-width:500px;max-height:150px;overflow-y:auto;font-size:11px}#log:empty{display:none}.log-entry{margin:2px 0}.green{color:#00ff88}.red{color:#ff4444}.gray{color:#888}</style></head><body>
<h1>IVAC TOKEN SERVER</h1>
<div class="stats">
<div class="stat-box active"><div class="stat-num" id="pool">-</div><div class="stat-label">AVAILABLE TOKENS</div></div>
<div class="stat-box"><div class="solver-status solver-none" id="solver">-</div><div class="stat-label">SOLVER STATUS</div></div>
</div>
<div class="btns"><button class="btn-green" onclick="solverStart()">START SOLVER</button><button class="btn-red" onclick="solverStop()">STOP SOLVER</button></div>
<div id="log"></div>
<script>var K='${API_KEY}',logEl=document.getElementById('log');function addLog(m,c){var t=new Date().toLocaleTimeString('en-US',{hour12:false});logEl.innerHTML+='<div class="log-entry '+(c||'gray')+'">['+t+'] '+m+'</div>';logEl.scrollTop=logEl.scrollHeight;while(logEl.children.length>20)logEl.removeChild(logEl.firstChild)}async function u(){try{var r=await fetch('/status?apiKey='+K);var d=await r.json();document.getElementById('pool').textContent=d.pool_size;var el=document.getElementById('solver');var cmd=d.solver_command||'none';el.textContent=cmd.toUpperCase();el.className='solver-status solver-'+cmd}catch(e){}}async function solverStart(){try{await fetch('/solverStart?apiKey='+K);addLog('START COMMAND SENT','green');u()}catch(e){addLog('ERROR: '+e.message,'red')}}async function solverStop(){try{await fetch('/solverStop?apiKey='+K);addLog('STOP COMMAND SENT','red');u()}catch(e){addLog('ERROR: '+e.message,'red')}}u();setInterval(u,3000)</script>
</body></html>`);
});

// ═══════════════════════════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
    console.log('IVAC TOKEN SERVER v3.0 | Port: ' + PORT + ' | API Key: ' + API_KEY);
});
