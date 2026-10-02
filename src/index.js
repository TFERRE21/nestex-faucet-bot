import 'dotenv/config';
import { chromium } from 'playwright';
import { logClaim } from './db.js';
import Database from 'better-sqlite3';
import http from 'node:http';

const FAUCETS_URL = process.env.NESTEX_URL || 'https://trade.nestex.one/faucets';
const INTERVAL_MS = Number(process.env.INTERVAL_MINUTES || 60) * 60 * 1000;
const TIMEOUT = Number(process.env.CLAIM_TIMEOUT_MS || 15000);
const PROFILE_DIR = process.env.NESTEX_PROFILE || 'data/nestex-profile';
const PORT = Number(process.env.NODE_APP_PORT || process.env.PORT || 3000);
const db = new Database('data/faucets.db');

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastStatus: 'Aguardando primeiro ciclo',
  lastMessage: '',
  faucetsFound: 0,
  currentFaucet: null,
  cycleClaims: 0,
  cycleErrors: 0
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NestEx Faucet Bot</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#0b1020;color:#e8ecf5}
.wrap{max-width:1180px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}
h1{margin:0;font-size:28px}.muted{color:#9aa5bd}.badge{padding:7px 12px;border-radius:999px;font-weight:700;background:#24304a}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}.card{background:#121a2d;border:1px solid #26324c;border-radius:14px;padding:18px}.label{font-size:13px;color:#9aa5bd}.value{font-size:25px;font-weight:800;margin-top:7px}
.panel{background:#121a2d;border:1px solid #26324c;border-radius:14px;padding:18px;margin-top:16px}.row{display:flex;justify-content:space-between;gap:15px;border-bottom:1px solid #222d45;padding:11px 0}.row:last-child{border-bottom:0}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #222d45}th{color:#9aa5bd}.ok{color:#67e8a5}.bad{color:#ff7d8a}.warn{color:#ffd166}
@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:500px){.grid{grid-template-columns:1fr}.wrap{padding:14px}}
</style>
</head>
<body><div class="wrap">
<div class="top"><div><h1>🚰 NestEx Faucet Bot</h1><div class="muted">Painel de acompanhamento automático</div></div><div id="badge" class="badge">Carregando...</div></div>
<div class="grid">
<div class="card"><div class="label">Faucets encontrados</div><div id="faucets" class="value">-</div></div>
<div class="card"><div class="label">Claims no ciclo</div><div id="claims" class="value">-</div></div>
<div class="card"><div class="label">Erros no ciclo</div><div id="errors" class="value">-</div></div>
<div class="card"><div class="label">Próximo ciclo</div><div id="next" class="value">-</div></div>
</div>
<div class="panel"><h2>Estado atual</h2>
<div class="row"><span class="muted">Último status</span><strong id="status">-</strong></div>
<div class="row"><span class="muted">Faucet atual</span><strong id="current">-</strong></div>
<div class="row"><span class="muted">Início do ciclo</span><strong id="started">-</strong></div>
<div class="row"><span class="muted">Fim do ciclo</span><strong id="finished">-</strong></div>
<div class="row"><span class="muted">Mensagem</span><strong id="message">-</strong></div>
</div>
<div class="panel"><h2>Últimos eventos</h2><div style="overflow:auto"><table><thead><tr><th>Data</th><th>Faucet</th><th>Status</th><th>Mensagem</th></tr></thead><tbody id="events"><tr><td colspan="4">Carregando...</td></tr></tbody></table></div></div>
<div class="muted" style="margin-top:18px">Atualização automática a cada 10 segundos.</div>
</div>
<script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>s?new Date(s).toLocaleString('pt-BR'):'-';
async function refresh(){
 try{
  const r=await fetch('/api/status',{cache:'no-store'}); const d=await r.json();
  document.querySelector('#badge').textContent=d.running?'🟢 EXECUTANDO':'🟡 AGUARDANDO';
  document.querySelector('#badge').className='badge '+(d.running?'ok':'warn');
  faucets.textContent=d.faucetsFound; claims.textContent=d.cycleClaims; errors.textContent=d.cycleErrors;
  next.textContent=d.running?'Em andamento':(d.nextRun?fmt(d.nextRun):'-');
  status.textContent=d.lastStatus||'-'; current.textContent=d.currentFaucet||'-';
  started.textContent=fmt(d.startedAt); finished.textContent=fmt(d.finishedAt); message.textContent=d.lastMessage||'-';
  const e=document.querySelector('#events');
  e.innerHTML=d.events.length?d.events.map(x=>'<tr><td>'+esc(fmt(x.run_at))+'</td><td>'+esc(x.coin||'-')+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.message||'')+'</td></tr>').join(''):'<tr><td colspan="4">Sem eventos.</td></tr>';
 }catch(e){document.querySelector('#badge').textContent='🔴 SEM RESPOSTA'}
}
refresh();setInterval(refresh,10000);
</script></body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    const events = db.prepare('SELECT run_at, coin, status, message FROM claims ORDER BY id DESC LIMIT 50').all();
    const nextRun = state.running || !state.finishedAt ? null : new Date(new Date(state.finishedAt).getTime() + INTERVAL_MS).toISOString();
    return sendJson(res, { ...state, nextRun, events });
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(dashboardHtml());
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
server.listen(PORT, '0.0.0.0', () => console.log(`Painel online em http://0.0.0.0:${PORT}`));

function hasHumanCheck(text) {
  return /captcha|turnstile|recaptcha|verify you are human|checking your browser/i.test(text || '');
}

async function runOnce() {
  if (state.running) {
    console.log('[SKIP] Ciclo anterior ainda está em execução.');
    return;
  }
  const started = Date.now();
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastStatus = 'Executando ciclo';
  state.lastMessage = '';
  state.faucetsFound = 0;
  state.currentFaucet = null;
  state.cycleClaims = 0;
  state.cycleErrors = 0;
  let context;

  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      executablePath: chromium.executablePath(),
      viewport: { width: 1280, height: 800 }
    });

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(TIMEOUT);

    console.log('\n==================================================');
    console.log(new Date().toISOString(), 'Iniciando ciclo NestEx');
    console.log('Perfil:', PROFILE_DIR);

    await page.goto(FAUCETS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(2500);

    if (/\/login(?:[/?#]|$)|\/logindo(?:[/?#]|$)/i.test(page.url())) {
      console.log('[STOP] Sessão NestEx não está autenticada.');
      logClaim(null, 'session_lost', 'Redirecionado para login', page.url());
      return;
    }

    let body = await page.locator('body').innerText().catch(() => '');
    if (hasHumanCheck(body)) {
      console.log('[STOP] CAPTCHA/Turnstile detectado na lista.');
      logClaim(null, 'captcha', 'Verificação humana detectada', page.url());
      return;
    }

    const rows = await page.locator('tr[onclick*="/faucets/"]').all();
    const faucets = [];

    for (const row of rows) {
      const onclick = await row.getAttribute('onclick').catch(() => null);
      const match = onclick && onclick.match(/location\.href=['"]\/faucets\/([^'"]+)['"]/i);
      if (!match) continue;

      const code = match[1];
      const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (!faucets.some(f => f.code === code)) faucets.push({ code, text });
    }

    state.faucetsFound = faucets.length;
    console.log('Faucets encontrados:', faucets.length);

    for (const faucet of faucets) {
      const url = new URL('/faucets/' + encodeURIComponent(faucet.code), FAUCETS_URL).href;
      state.currentFaucet = faucet.code;
      console.log('\n[' + faucet.code + '] ' + faucet.text);

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(1200);

        if (/\/login(?:[/?#]|$)|\/logindo(?:[/?#]|$)/i.test(page.url())) {
          console.log('[' + faucet.code + '] Sessão perdida. Parando ciclo.');
          logClaim(faucet.code, 'session_lost', 'Redirecionado para login', page.url());
          break;
        }

        body = await page.locator('body').innerText().catch(() => '');

        if (hasHumanCheck(body)) {
          console.log('[' + faucet.code + '] CAPTCHA/Turnstile detectado. Parando ciclo.');
          logClaim(faucet.code, 'captcha', 'Verificação humana detectada', page.url());
          break;
        }

        const claim = page.getByRole('button', { name: /claim now/i }).first();

        if (await claim.count() === 0) {
          console.log('[' + faucet.code + '] Botão Claim Now não encontrado.');
          logClaim(faucet.code, 'unavailable', 'Botão Claim Now não encontrado', page.url());
          continue;
        }

        if (!(await claim.isVisible().catch(() => false))) {
          console.log('[' + faucet.code + '] Claim não visível.');
          logClaim(faucet.code, 'unavailable', 'Botão Claim não visível', page.url());
          continue;
        }

        if (await claim.isDisabled().catch(() => false)) {
          console.log('[' + faucet.code + '] Claim desabilitado.');
          logClaim(faucet.code, 'unavailable', 'Botão Claim desabilitado', page.url());
          continue;
        }

        console.log('[' + faucet.code + '] Claim disponível -> clicando...');
        await claim.scrollIntoViewIfNeeded();
        await claim.click({ timeout: TIMEOUT });

        await page.waitForTimeout(1800);

        const after = await page.locator('body').innerText().catch(() => '');

        if (hasHumanCheck(after)) {
          console.log('[' + faucet.code + '] CAPTCHA/Turnstile após clique. Parando.');
          logClaim(faucet.code, 'captcha', 'Verificação humana após clique', page.url());
          break;
        }

        if (/\/login(?:[/?#]|$)|\/logindo(?:[/?#]|$)/i.test(page.url())) {
          console.log('[' + faucet.code + '] Sessão perdida após clique.');
          logClaim(faucet.code, 'session_lost', 'Redirecionado para login após claim', page.url());
          break;
        }

        const lower = after.toLowerCase();
        const success = /success|claimed|claim successful|successfully|sent|received|already claimed|wait.*hour|next claim/i.test(lower);

        if (success) {
          console.log('[' + faucet.code + '] Claim processado/confirmado pela página.');
          logClaim(faucet.code, 'claimed', 'Claim acionado e resposta da página registrada', page.url());
          state.cycleClaims++;
        } else {
          console.log('[' + faucet.code + '] Clique realizado; resposta não conclusiva.');
          logClaim(faucet.code, 'clicked', 'Claim acionado; resposta não conclusiva', page.url());
          state.cycleClaims++;
        }

      } catch (err) {
        console.log('[' + faucet.code + '] ERRO:', err.message);
        logClaim(faucet.code, 'error', err.message, page.url());
        state.cycleErrors++;
      }
    }

    state.lastStatus = 'Ciclo concluído';
    state.lastMessage = 'Ciclo concluído em ' + Math.round((Date.now() - started) / 1000) + ' segundos.';
    state.currentFaucet = null;
    console.log('\nCiclo concluído em', Math.round((Date.now() - started) / 1000), 'segundos.');
  } catch (err) {
    console.error('[RUN ERROR]', err);
    logClaim(null, 'run_error', err.message, FAUCETS_URL);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

await runOnce();

console.log('Próximo ciclo em ' + (INTERVAL_MS / 60000) + ' minutos.');
setInterval(runOnce, INTERVAL_MS);
