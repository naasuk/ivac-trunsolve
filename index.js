const functions = require('@google-cloud/functions-framework');
const { Firestore } = require('@google-cloud/firestore');
const cors = require('cors');

const db = new Firestore();
const tokensRef = db.collection('tokens');
const statsRef = db.collection('stats').doc('server');

const API_KEY = 'riadtoken';
const TOKEN_MAX_AGE = 200;

const corsHandler = cors({ origin: true });

function authCheck(req) {
    return (req.headers['x-api-key'] || req.body?.apiKey || req.query?.apiKey) === API_KEY;
}

async function cleanupExpired() {
    const cutoff = Date.now() - (TOKEN_MAX_AGE * 1000);
    const expired = await tokensRef.where('timestamp', '<', cutoff).get();
    const batch = db.batch();
    expired.forEach(doc => batch.delete(doc.ref));
    if (!expired.empty) await batch.commit();
    return expired.size;
}

functions.http('helloHttp', async (req, res) => {
    corsHandler(req, res, async () => {
        const path = req.path.replace(/^\//, '');

        if (path === 'storeToken' && req.method === 'POST') {
            if (!authCheck(req)) return res.status(401).json({ error: 'INVALID API KEY' });
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: 'MISSING TOKEN' });

            await tokensRef.add({ token: token.trim(), timestamp: Date.now() });
            await statsRef.set({ total_solved: Firestore.FieldValue.increment(1) }, { merge: true });
            await cleanupExpired();
            const pool = await tokensRef.count().get();

            const statsDoc = await statsRef.get();
            return res.json({
                success: true,
                pool_size: pool.data().count,
                total_solved: statsDoc.exists ? statsDoc.data().total_solved : 0
            });

        } else if (path === 'getToken' && req.method === 'GET') {
            if (!authCheck(req)) return res.status(401).json({ error: 'INVALID API KEY' });
            await cleanupExpired();
            const result = await db.runTransaction(async (t) => {
                const snapshot = await t.get(tokensRef.orderBy('timestamp', 'asc').limit(1));
                if (snapshot.empty) return null;
                const doc = snapshot.docs[0];
                const data = doc.data();
                t.delete(doc.ref);
                const age = Math.round((Date.now() - data.timestamp) / 1000);
                return { token: data.token, age: age, remaining_life: TOKEN_MAX_AGE - age };
            });
            if (!result) return res.json({ success: false, error: 'NO TOKENS AVAILABLE' });
            return res.json({ success: true, token: result.token, age: result.age, remaining_life: result.remaining_life });

        } else if (path === 'solverStart' && req.method === 'GET') {
            if (!authCheck(req)) return res.status(401).json({ error: 'INVALID API KEY' });
            await statsRef.set({ solver_command: 'start' }, { merge: true });
            return res.json({ success: true, command: 'start' });

        } else if (path === 'solverStop' && req.method === 'GET') {
            if (!authCheck(req)) return res.status(401).json({ error: 'INVALID API KEY' });
            await statsRef.set({ solver_command: 'stop' }, { merge: true });
            return res.json({ success: true, command: 'stop' });

        } else if (path === 'status' && req.method === 'GET') {
            if (!authCheck(req)) return res.status(401).json({ error: 'INVALID API KEY' });
            await cleanupExpired();
            const pool = await tokensRef.count().get();
            const statsDoc = await statsRef.get();
            const data = statsDoc.exists ? statsDoc.data() : {};
            return res.json({
                pool_size: pool.data().count,
                total_solved: data.total_solved || 0,
                token_max_age: TOKEN_MAX_AGE,
                solver_command: data.solver_command || 'none'
            });

        } else if (path === 'dashboard') {
            return res.send(`<!DOCTYPE html>
<html><head><title>IVAC Token Server</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#e0e0e0;font-family:'Consolas',monospace;padding:30px}h1{color:#00ff88;margin-bottom:20px}.stats{display:flex;gap:15px;margin-bottom:20px}.stat{background:#0f0f23;border:1px solid #333;border-radius:8px;padding:15px 20px;text-align:center}.stat .val{color:#00ff88;font-size:28px;font-weight:bold}.stat .lbl{color:#888;font-size:11px;text-transform:uppercase;margin-top:4px}button{background:#00ff88;color:#0f0f23;border:none;padding:10px 20px;border-radius:6px;font-family:inherit;font-size:14px;font-weight:bold;cursor:pointer;margin-right:10px}button:hover{background:#00cc6a}.btn-red{background:#ff4444;color:#fff}.btn-red:hover{background:#cc3333}#log{background:#0f0f23;border:1px solid #333;border-radius:8px;padding:15px;margin-top:15px;max-height:400px;overflow-y:auto;font-size:12px;white-space:pre-wrap}.green{color:#00ff88}.red{color:#ff4444}.yellow{color:#ffaa00}</style></head><body>
<h1>IVAC TOKEN SERVER — FIREBASE</h1>
<div class="stats"><div class="stat"><div class="val" id="pool">-</div><div class="lbl">POOL</div></div><div class="stat"><div class="val" id="solved">-</div><div class="lbl">TOTAL SOLVED</div></div><div class="stat"><div class="val" id="solver">-</div><div class="lbl">SOLVER</div></div></div>
<button onclick="getStatus()">REFRESH</button><button onclick="getToken()">GET TOKEN</button><button onclick="solverStart()">START SOLVER</button><button class="btn-red" onclick="solverStop()">STOP SOLVER</button>
<div id="log"></div>
<script>var API_KEY='riadtoken',BASE=window.location.href.replace(/\\/dashboard.*/,''),logEl=document.getElementById('log');function addLog(m,c){var t=new Date().toLocaleTimeString('en-US',{hour12:false});logEl.innerHTML+='<div class="'+(c||'')+'">['+t+'] '+m+'</div>';logEl.scrollTop=logEl.scrollHeight}async function getStatus(){try{var r=await fetch(BASE+'/status?apiKey='+API_KEY);var d=await r.json();document.getElementById('pool').textContent=d.pool_size;document.getElementById('solved').textContent=d.total_solved;document.getElementById('solver').textContent=(d.solver_command||'none').toUpperCase();addLog('STATUS: Pool='+d.pool_size+' | Solved='+d.total_solved+' | Solver='+d.solver_command,'green')}catch(e){addLog('ERROR: '+e.message,'red')}}async function getToken(){try{var r=await fetch(BASE+'/getToken?apiKey='+API_KEY);var d=await r.json();if(d.success){addLog('TOKEN: '+d.token.substring(0,40)+'... | Age='+d.age+'s | Life='+d.remaining_life+'s','green')}else{addLog('NO TOKENS AVAILABLE','yellow')}getStatus()}catch(e){addLog('ERROR: '+e.message,'red')}}async function solverStart(){try{var r=await fetch(BASE+'/solverStart?apiKey='+API_KEY);var d=await r.json();addLog('SOLVER START COMMAND SENT','green');getStatus()}catch(e){addLog('ERROR: '+e.message,'red')}}async function solverStop(){try{var r=await fetch(BASE+'/solverStop?apiKey='+API_KEY);var d=await r.json();addLog('SOLVER STOP COMMAND SENT','red');getStatus()}catch(e){addLog('ERROR: '+e.message,'red')}}getStatus();setInterval(getStatus,10000)</script></body></html>`);

        } else {
            return res.json({ service: 'IVAC Token Server', status: 'running', endpoints: ['/storeToken', '/getToken', '/status', '/dashboard', '/solverStart', '/solverStop'] });
        }
    });
});