import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });

const display = process.env.DISPLAY || ':99';
const url = process.env.NESTEX_URL || 'https://trade.nestex.one/faucets';
const profileDir = process.env.NESTEX_PROFILE || 'data/nestex-profile';

fs.mkdirSync(profileDir, { recursive: true });

console.log('Iniciando navegador gráfico persistente em', display);
console.log('Perfil:', profileDir);
console.log('Abra o noVNC e faça o login manualmente.');
console.log('O script só considerará o login concluído após confirmar acesso autenticado à página /faucets. Não precisa pressionar ENTER.');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  env: { ...process.env, DISPLAY: display },
  viewport: { width: 1280, height: 800 }
});

const page = context.pages()[0] || await context.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('URL inicial:', page.url());

const deadline = Date.now() + 10 * 60 * 1000;
let lastUrl = '';

while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const currentUrl = page.url();

  if (currentUrl !== lastUrl) {
    console.log('Aguardando login... URL:', currentUrl);
    lastUrl = currentUrl;
  }

  // /logindo is an intermediate route and is NOT proof of authentication.
  if (/\/login(?:[/?#]|$)/i.test(currentUrl) || /\/logindo(?:[/?#]|$)/i.test(currentUrl)) {
    continue;
  }

  // Re-check the protected target. A real authenticated session must be able
  // to reach /faucets without being redirected back to /login.
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.log('Falha ao validar /faucets:', err.message);
    continue;
  }

  const verifiedUrl = page.url();
  console.log('Validando sessão... URL:', verifiedUrl);

  if (/\/login(?:[/?#]|$)/i.test(verifiedUrl) || /\/logindo(?:[/?#]|$)/i.test(verifiedUrl)) {
    continue;
  }

  if (/\/faucets(?:[/?#]|$)/i.test(verifiedUrl)) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
    const lowerBody = body.toLowerCase();

    // Do not claim success merely because the URL changed. The protected
    // page should contain faucet-related content.
    if (lowerBody.includes('faucet') || lowerBody.includes('claim') || lowerBody.includes('collect')) {
      console.log('LOGIN DETECTADO!');
      console.log('Sessão autenticada confirmada em:', verifiedUrl);
      console.log('Perfil persistente salvo em:', profileDir);
      await context.close();
      process.exit(0);
    }
  }
}

console.error('Tempo limite de 10 minutos atingido sem confirmar sessão autenticada.');
await context.close();
process.exit(1);
