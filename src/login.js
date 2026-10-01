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
console.log('O script aguardará até a conta sair da página /login. Não precisa pressionar ENTER.');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  env: { ...process.env, DISPLAY: display },
  viewport: { width: 1280, height: 800 }
});

const page = context.pages()[0] || await context.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('URL inicial:', page.url());

const deadline = Date.now() + 10 * 60 * 1000;

while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const currentUrl = page.url();
  console.log('Aguardando login... URL:', currentUrl);

  if (!/\/login(?:[/?#]|$)/i.test(currentUrl)) {
    console.log('LOGIN DETECTADO!');
    console.log('URL autenticada:', currentUrl);
    console.log('Perfil persistente salvo em:', profileDir);
    await context.close();
    process.exit(0);
  }
}

console.error('Tempo limite de 10 minutos atingido sem detectar login.');
await context.close();
process.exit(1);
