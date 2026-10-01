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
console.log('Abra a interface noVNC, faça o login manualmente e depois pressione ENTER aqui.');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  env: { ...process.env, DISPLAY: display },
  viewport: { width: 1280, height: 800 }
});

const page = context.pages()[0] || await context.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('URL inicial:', page.url());

process.stdin.setEncoding('utf8');
process.stdin.resume();

process.stdin.once('data', async () => {
  try {
    console.log('URL após login:', page.url());
    console.log('Perfil persistente salvo em:', profileDir);
  } finally {
    await context.close();
    process.exit(0);
  }
});
