const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
//  IVAC CAPTCHA TOKEN SERVER v1.0
//  Stores manually-solved Turnstile tokens for IVAC tool
// ═══════════════════════════════════════════════════════════

// Load config
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PORT = config.port || 5000;
const API_KEY = config.apiKey;
const TOKEN_MAX_AGE = (config.tokenMaxAge || 200) * 1000; // convert to ms
const CLEANUP_INTERVAL = (config.cleanupInterval || 15) * 1000; // convert to ms

// Token pool — array of { token, timestamp }
const tokenPool = [];
let totalSolved = 0;
const startTime = Date.now();

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key']
}));

// ─── Auth middleware ───
function authCheck(req, res, next) {
    const key = req.headers['x-api-key'] || req.body?.apiKey || req.query?.apiKey;
    if (!key || key !== API_KEY) {
        return res.status(401).json({ error: 'INVALID API KEY' });
    }
    next();
}

// ─── Cleanup expired tokens ───
function cleanupExpired() {
    const now = Date.now();
    let removed = 0;
    for (let i = tokenPool.length - 1; i >= 0; i--) {
        if (now - tokenPool[i].timestamp > TOKEN_MAX_AGE) {
            tokenPool.splice(i, 1);
            removed++;
        }
    }
    if (removed > 0) {
        log(`CLEANUP: ${removed} expired token(s) removed | Pool: ${tokenPool.length}`);
    }
}

// Run cleanup every N seconds
setInterval(cleanupExpired, CLEANUP_INTERVAL);

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

// POST /storeToken — browser sends solved token
app.post('/storeToken', authCheck, (req, res) => {
    const { token } = req.body;

    if (!token || typeof token !== 'string' || token.trim() === '') {
        return res.status(400).json({ error: 'MISSING OR INVALID TOKEN' });
    }

    tokenPool.push({
        token: token.trim(),
        timestamp: Date.now()
    });
    totalSolved++;

    log(`STORED: Token #${totalSolved} | Pool: ${tokenPool.length} | Length: ${token.length}`);

    res.json({
        success: true,
        pool_size: tokenPool.length,
        total_solved: totalSolved
    });
});

// GET /getToken — IVAC tool fetches a token
app.get('/getToken', authCheck, (req, res) => {
    // Clean expired first
    cleanupExpired();

    if (tokenPool.length === 0) {
        log('FETCH: No tokens available');
        return res.json({ success: false, error: 'NO TOKENS AVAILABLE' });
    }

    // Return oldest valid token (FIFO)
    const entry = tokenPool.shift();
    const age = Math.round((Date.now() - entry.timestamp) / 1000);
    const remaining_life = (config.tokenMaxAge || 200) - age;

    log(`FETCH: Token served | Age: ${age}s | Life: ${remaining_life}s | Remaining: ${tokenPool.length}`);

    res.json({
        success: true,
        token: entry.token,
        age: age,
        remaining_life: remaining_life
    });
});

// GET /status — check pool status
app.get('/status', authCheck, (req, res) => {
    cleanupExpired();

    const uptime = formatUptime(Date.now() - startTime);
    const ages = tokenPool.map(t => Math.round((Date.now() - t.timestamp) / 1000));

    res.json({
        pool_size: tokenPool.length,
        total_solved: totalSolved,
        uptime: uptime,
        token_max_age: config.tokenMaxAge || 200,
        oldest_token_age: ages.length > 0 ? Math.max(...ages) : null,
        newest_token_age: ages.length > 0 ? Math.min(...ages) : null
    });
});

// GET /dashboard — browser test page
app.get('/dashboard', (req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>IVAC Token Server</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; color: #e0e0e0; font-family: 'Consolas', monospace; padding: 30px; }
    h1 { color: #00ff88; margin-bottom: 20px; }
    .stats { display: flex; gap: 15px; margin-bottom: 20px; }
    .stat { background: #0f0f23; border: 1px solid #333; border-radius: 8px; padding: 15px 20px; text-align: center; }
    .stat .val { color: #00ff88; font-size: 28px; font-weight: bold; }
    .stat .lbl { color: #888; font-size: 11px; text-transform: uppercase; margin-top: 4px; }
    button { background: #00ff88; color: #0f0f23; border: none; padding: 10px 20px; border-radius: 6px; font-family: inherit; font-size: 14px; font-weight: bold; cursor: pointer; margin-right: 10px; }
    button:hover { background: #00cc6a; }
    #log { background: #0f0f23; border: 1px solid #333; border-radius: 8px; padding: 15px; margin-top: 15px; max-height: 400px; overflow-y: auto; font-size: 12px; white-space: pre-wrap; }
    .green { color: #00ff88; } .red { color: #ff4444; } .yellow { color: #ffaa00; }
</style></head><body>
    <h1>⚡ IVAC TOKEN SERVER DASHBOARD</h1>
    <div class="stats">
        <div class="stat"><div class="val" id="pool">-</div><div class="lbl">POOL</div></div>
        <div class="stat"><div class="val" id="solved">-</div><div class="lbl">TOTAL SOLVED</div></div>
        <div class="stat"><div class="val" id="uptime">-</div><div class="lbl">UPTIME</div></div>
    </div>
    <button onclick="getStatus()">REFRESH STATUS</button>
    <button onclick="getToken()">GET TOKEN (TEST)</button>
    <div id="log"></div>
<script>
    const API_KEY = '` + API_KEY + `';
    const logEl = document.getElementById('log');

    function addLog(msg, cls) {
        const t = new Date().toLocaleTimeString('en-US', { hour12: false });
        logEl.innerHTML += '<div class="' + (cls||'') + '">[' + t + '] ' + msg + '</div>';
        logEl.scrollTop = logEl.scrollHeight;
    }

    async function getStatus() {
        try {
            const r = await fetch('/status', { headers: { 'X-API-Key': API_KEY } });
            const d = await r.json();
            document.getElementById('pool').textContent = d.pool_size;
            document.getElementById('solved').textContent = d.total_solved;
            document.getElementById('uptime').textContent = d.uptime;
            addLog('STATUS: Pool=' + d.pool_size + ' | Solved=' + d.total_solved + ' | Uptime=' + d.uptime, 'green');
        } catch(e) { addLog('ERROR: ' + e.message, 'red'); }
    }

    async function getToken() {
        try {
            const r = await fetch('/getToken', { headers: { 'X-API-Key': API_KEY } });
            const d = await r.json();
            if (d.success) {
                addLog('TOKEN: ' + d.token.substring(0, 40) + '... | Age=' + d.age + 's | Life=' + d.remaining_life + 's', 'green');
            } else {
                addLog('NO TOKENS AVAILABLE', 'yellow');
            }
            getStatus();
        } catch(e) { addLog('ERROR: ' + e.message, 'red'); }
    }

    getStatus();
    setInterval(getStatus, 10000);
</script>
</body></html>`);
});

// ═══════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════

// Get machine IP
function getLocalIP() {
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    const serverURL = `http://${ip}:${PORT}`;

    console.log('');
    console.log('  ╔═══════════════════════════════════════════════╗');
    console.log('  ║     IVAC CAPTCHA TOKEN SERVER v1.0            ║');
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log(`  ║  SERVER:     ${serverURL.padEnd(33)}║`);
    console.log(`  ║  API KEY:    ${API_KEY.padEnd(33)}║`);
    console.log(`  ║  MAX AGE:    ${String((config.tokenMaxAge || 200) + 's').padEnd(33)}║`);
    console.log(`  ║  CLEANUP:    Every ${String((config.cleanupInterval || 15) + 's').padEnd(27)}║`);
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log(`  ║  STORE:  ${(serverURL + '/storeToken').padEnd(37)}║`);
    console.log(`  ║  FETCH:  ${(serverURL + '/getToken').padEnd(37)}║`);
    console.log(`  ║  STATUS: ${(serverURL + '/status').padEnd(37)}║`);
    console.log(`  ║  DASH:   ${(serverURL + '/dashboard').padEnd(37)}║`);
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');
    log('Server started — waiting for tokens...');
});
