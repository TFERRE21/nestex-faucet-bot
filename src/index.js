import 'dotenv/config';
import { chromium } from 'playwright';
import { logClaim } from './db.js';
import fs from 'node:fs';

const URL = process.env.NESTEX_URL || 'https://trade.nestex.one/faucets';
const interval = Number(process.env.INTERVAL_MINUTES || 60) * 60 * 1000;
const headless = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const timeout = Number(process.env.CLAIM_TIMEOUT_MS || 15000);

if (!fs.existsSync('data/storageState.json')) {
  console.error('Sessão não encontrada. Rode: npm run login');
  process.exit(1);
}

let running = false;
async function runOnce(){
  if (running) return;
  running = true;
  const browser = await chromium.launch({headless});
  const context = await browser.newContext({storageState:'data/storageState.json'});
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  try {
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
    await context.storageState({path:'data/storageState.json'});
  } catch(e){
    logClaim(null,'run_error',e.message,page.url());
    console.error(e);
  } finally {
    await browser.close();
    running = false;
  }
}

await runOnce();
setInterval(runOnce, interval);
console.log(`Agendado a cada ${interval/60000} minutos.`);
