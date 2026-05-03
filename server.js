const express = require('express');
const cors = require('cors');

// ═══════════════════════════════════════════════════════════
//  IVAC CAPTCHA TOKEN SERVER v2.0 (Render Edition)
// ═══════════════════════════════════════════════════════════

const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY || 'riadtoken';
const TOKEN_MAX_AGE = 200; // seconds
const CLEANUP_INTERVAL = 15; // seconds

// Token pool
const tokenPool = [];
let totalSolved = 0;
let solverCommand = 'none';
const startTime = Date.now();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-API-Key'] }));

// ─── Auth middleware ───
function authCheck(req, res, next) {
    const key = req.headers['x-api-key'] || req.body?.apiKey || req.query?.apiKey;
    if (!key || key !== API_KEY) return res.status(401).json({ error: 'INVALID API KEY' });
    next();
}

// ─── Cleanup expired tokens ───
function cleanupExpired() {
    const now = Date.now();
    let removed = 0;
    for (let i = tokenPool.length - 1; i >= 0; i--) {
        if (now - tokenPool[i].timestamp > TOKEN_MAX_AGE * 1000) {
            tokenPool.splice(i, 1);
            removed++;
        }
    }
    if (removed > 0) log(`CLEANUP: ${removed} expired token(s) removed | Pool: ${tokenPool.length}`);
}

setInterval(cleanupExpired, CLEANUP_INTERVAL * 1000);

// ─── Logging ───
function log(msg) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${time}] ${msg}`);
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

// ═══════════════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════════════

// POST /storeToken
app.post('/storeToken', authCheck, (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.trim() === '') {
        return res.status(400).json({ error: 'MISSING OR INVALID TOKEN' });
    }

    tokenPool.push({ token: token.trim(), timestamp: Date.now() });
    totalSolved++;

    log(`STORED: Token #${totalSolved} | Pool: ${tokenPool.length} | Length: ${token.length}`);

    res.json({ success: true, pool_size: tokenPool.length, total_solved: totalSolved });
});

// GET /getToken
app.get('/getToken', authCheck, (req, res) => {
    cleanupExpired();

    if (tokenPool.length === 0) {
        log('FETCH: No tokens available');
        return res.json({ success: false, error: 'NO TOKENS AVAILABLE' });
    }

    const entry = tokenPool.pop();
    const age = Math.round((Date.now() - entry.timestamp) / 1000);
    const remaining_life = TOKEN_MAX_AGE - age;

    log(`FETCH: Token served | Age: ${age}s | Life: ${remaining_life}s | Remaining: ${tokenPool.length}`);

    res.json({ success: true, token: entry.token, age: age, remaining_life: remaining_life });
});

// GET /status
app.get('/status', authCheck, (req, res) => {
    cleanupExpired();
    res.json({
        pool_size: tokenPool.length,
        total_solved: totalSolved,
        uptime: formatUptime(Date.now() - startTime),
        token_max_age: TOKEN_MAX_AGE,
        solver_command: solverCommand
    });
});

// GET /solverStart
app.get('/solverStart', authCheck, (req, res) => {
    solverCommand = 'start';
    log('COMMAND: Solver START');
    res.json({ success: true, command: 'start' });
});

// GET /solverStop
app.get('/solverStop', authCheck, (req, res) => {
    solverCommand = 'stop';
    log('COMMAND: Solver STOP');
    res.json({ success: true, command: 'stop' });
});

// GET /health — for UptimeRobot to keep server awake
app.get('/health', (req, res) => {
    res.json({ status: 'ok', pool: tokenPool.length, uptime: formatUptime(Date.now() - startTime) });
});

// GET /dashboard
app.get('/dashboard', (req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>IVAC Token Server</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#e0e0e0;font-family:'Consolas',monospace;padding:30px}h1{color:#00ff88;margin-bottom:20px}.stats{display:flex;gap:15px;margin-bottom:20px;flex-wrap:wrap}.stat{background:#0f0f23;border:1px solid #333;border-radius:8px;padding:15px 20px;text-align:center}.stat .val{color:#00ff88;font-size:28px;font-weight:bold}.stat .lbl{color:#888;font-size:11px;text-transform:uppercase;margin-top:4px}button{background:#00ff88;color:#0f0f23;border:none;padding:10px 20px;border-radius:6px;font-family:inherit;font-size:14px;font-weight:bold;cursor:pointer;margin-right:10px;margin-bottom:10px}button:hover{background:#00cc6a}.btn-red{background:#ff4444;color:#fff}.btn-red:hover{background:#cc3333}#log{background:#0f0f23;border:1px solid #333;border-radius:8px;padding:15px;margin-top:15px;max-height:400px;overflow-y:auto;font-size:12px;white-space:pre-wrap}.green{color:#00ff88}.red{color:#ff4444}.yellow{color:#ffaa00}</style></head><body>
<h1>IVAC TOKEN SERVER — RENDER</h1>
<div class="stats"><div class="stat"><div class="val" id="pool">-</div><div class="lbl">POOL</div></div><div class="stat"><div class="val" id="solved">-</div><div class="lbl">TOTAL SOLVED</div></div><div class="stat"><div class="val" id="uptime">-</div><div class="lbl">UPTIME</div></div><div class="stat"><div class="val" id="solver">-</div><div class="lbl">SOLVER</div></div></div>
<button onclick="getStatus()">REFRESH</button><button onclick="getToken()">GET TOKEN</button><button onclick="solverStart()">START SOLVER</button><button class="btn-red" onclick="solverStop()">STOP SOLVER</button>
<div id="log"></div>
<script>var API_KEY='${API_KEY}',logEl=document.getElementById('log');function addLog(m,c){var t=new Date().toLocaleTimeString('en-US',{hour12:false});logEl.innerHTML+='<div class="'+(c||'')+'">['+t+'] '+m+'</div>';logEl.scrollTop=logEl.scrollHeight}async function getStatus(){try{var r=await fetch('/status?apiKey='+API_KEY);var d=await r.json();document.getElementById('pool').textContent=d.pool_size;document.getElementById('solved').textContent=d.total_solved;document.getElementById('uptime').textContent=d.uptime;document.getElementById('solver').textContent=(d.solver_command||'none').toUpperCase();addLog('STATUS: Pool='+d.pool_size+' | Solved='+d.total_solved+' | Uptime='+d.uptime+' | Solver='+d.solver_command,'green')}catch(e){addLog('ERROR: '+e.message,'red')}}async function getToken(){try{var r=await fetch('/getToken?apiKey='+API_KEY);var d=await r.json();if(d.success){addLog('TOKEN: '+d.token.substring(0,40)+'... | Age='+d.age+'s | Life='+d.remaining_life+'s','green')}else{addLog('NO TOKENS AVAILABLE','yellow')}getStatus()}catch(e){addLog('ERROR: '+e.message,'red')}}async function solverStart(){try{await fetch('/solverStart?apiKey='+API_KEY);addLog('SOLVER START COMMAND SENT','green');getStatus()}catch(e){addLog('ERROR: '+e.message,'red')}}async function solverStop(){try{await fetch('/solverStop?apiKey='+API_KEY);addLog('SOLVER STOP COMMAND SENT','red');getStatus()}catch(e){addLog('ERROR: '+e.message,'red')}}getStatus();setInterval(getStatus,10000)</script></body></html>`);
});

// ═══════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════╗');
    console.log('  ║     IVAC CAPTCHA TOKEN SERVER v2.0            ║');
    console.log('  ║     Render Edition                            ║');
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log(`  ║  PORT:       ${String(PORT).padEnd(33)}║`);
    console.log(`  ║  API KEY:    ${API_KEY.padEnd(33)}║`);
    console.log(`  ║  MAX AGE:    ${String(TOKEN_MAX_AGE + 's').padEnd(33)}║`);
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log('  ║  POST /storeToken   — Store solved token      ║');
    console.log('  ║  GET  /getToken     — Fetch token (JSON)      ║');
    console.log('  ║  GET  /status       — Pool status             ║');
    console.log('  ║  GET  /solverStart  — Remote start solver     ║');
    console.log('  ║  GET  /solverStop   — Remote stop solver      ║');
    console.log('  ║  GET  /health       — Keep-alive endpoint     ║');
    console.log('  ║  GET  /dashboard    — Browser dashboard       ║');
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');
    log('Server started — waiting for tokens...');
});
