import 'dotenv/config';
import { chromium } from 'playwright';
import { logClaim } from './db.js';
import fs from 'node:fs';

const URL = process.env.NESTEX_URL || 'https://trade.nestex.one/faucets';
const interval = Number(process.env.INTERVAL_MINUTES || 60) * 60 * 1000;
const headless = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const timeout = Number(process.env.CLAIM_TIMEOUT_MS || 15000);
const storagePath = process.env.STORAGE_STATE_PATH || 'data/storageState.json';

function loadSessionFromEnv() {
  if (!process.env.STORAGE_STATE_B64 || fs.existsSync(storagePath)) return true;
  try {
    fs.mkdirSync('data', { recursive: true });
    const decoded = Buffer.from(process.env.STORAGE_STATE_B64, 'base64').toString('utf8');
    JSON.parse(decoded);
    fs.writeFileSync(storagePath, decoded, { mode: 0o600 });
    console.log('Sessão inicial carregada a partir de STORAGE_STATE_B64.');
    return true;
  } catch (e) {
    console.error('STORAGE_STATE_B64 inválido:', e.message);
    return false;
  }
}

let running = false;
async function runOnce(){
  if (running) return;
  running = true;

  try {
    if (!loadSessionFromEnv() || !fs.existsSync(storagePath)) {
      console.log('Aguardando sessão NestEx. Configure STORAGE_STATE_B64 ou forneça data/storageState.json.');
      return;
    }

    const browser = await chromium.launch({headless});
    try {
      const context = await browser.newContext({storageState:storagePath});
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);

      await page.goto(URL,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(3000);

      const body = (await page.locator('body').innerText()).toLowerCase();
      if (/captcha|turnstile|verify you are human|recaptcha/.test(body)) {
        console.log('CAPTCHA/verificação detectada. Não vou tentar contornar.');
        await page.screenshot({path:`data/captcha-${Date.now()}.png`,fullPage:true});
        logClaim(null,'captcha','Verificação humana detectada',page.url());
        return;
      }

      const candidates = page.locator('button, a, [role="button"]');
      const count = await candidates.count();
      let found = 0;
      for(let i=0;i<count;i++){
        const el = candidates.nth(i);
        const text = ((await el.innerText().catch(()=>'')) || '').trim();
        if (!/claim|collect|receive/i.test(text)) continue;
        if (!(await el.isVisible().catch(()=>false))) continue;
        found++;
        const label = text.replace(/\s+/g,' ').slice(0,120);
        try {
          await el.scrollIntoViewIfNeeded();
          await el.click({timeout});
          await page.waitForTimeout(1200);
          const after = ((await page.locator('body').innerText().catch(()=>'')) || '').toLowerCase();
          if (/captcha|turnstile|recaptcha|verify you are human/.test(after)) {
            logClaim(label,'captcha','Verificação humana após clique',page.url());
            await page.screenshot({path:`data/captcha-${Date.now()}.png`,fullPage:true});
            break;
          }
          logClaim(label,'clicked','Botão acionado; confirmar resultado pela interface',page.url());
        } catch(e) {
          logClaim(label,'error',e.message,page.url());
        }
      }

      console.log(new Date().toISOString(), 'claims acionados:', found);
      await context.storageState({path:storagePath});
    } finally {
      await browser.close();
    }
  } catch(e) {
    logClaim(null,'run_error',e.message,URL);
    console.error(e);
  } finally {
    running = false;
  }
}

await runOnce();
setInterval(runOnce, interval);
console.log(`Agendado a cada ${interval/60000} minutos.`);
