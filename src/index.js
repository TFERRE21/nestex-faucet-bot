import 'dotenv/config';
import { chromium } from 'playwright';
import { logClaim } from './db.js';

const FAUCETS_URL = process.env.NESTEX_URL || 'https://trade.nestex.one/faucets';
const INTERVAL_MS = Number(process.env.INTERVAL_MINUTES || 60) * 60 * 1000;
const TIMEOUT = Number(process.env.CLAIM_TIMEOUT_MS || 15000);
const PROFILE_DIR = process.env.NESTEX_PROFILE || 'data/nestex-profile';

function hasHumanCheck(text) {
  return /captcha|turnstile|recaptcha|verify you are human|checking your browser/i.test(text || '');
}

async function runOnce() {
  const started = Date.now();
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

    console.log('Faucets encontrados:', faucets.length);

    for (const faucet of faucets) {
      const url = new URL('/faucets/' + encodeURIComponent(faucet.code), FAUCETS_URL).href;
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
        } else {
          console.log('[' + faucet.code + '] Clique realizado; resposta não conclusiva.');
          logClaim(faucet.code, 'clicked', 'Claim acionado; resposta não conclusiva', page.url());
        }

      } catch (err) {
        console.log('[' + faucet.code + '] ERRO:', err.message);
        logClaim(faucet.code, 'error', err.message, page.url());
      }
    }

    console.log('\nCiclo concluído em', Math.round((Date.now() - started) / 1000), 'segundos.');
  } catch (err) {
    console.error('[RUN ERROR]', err);
    logClaim(null, 'run_error', err.message, FAUCETS_URL);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

await runOnce();

console.log('Próximo ciclo em ' + (INTERVAL_MS / 60000) + ' minutos.');
setInterval(runOnce, INTERVAL_MS);
