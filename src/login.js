import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });

const display = process.env.DISPLAY || ':99';
const url = process.env.NESTEX_URL || 'https://trade.nestex.one/faucets';

console.log('Iniciando navegador gráfico em', display);
console.log('Abra a interface noVNC, faça o login manualmente e depois pressione ENTER aqui.');

const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, DISPLAY: display }
});

const context = await browser.newContext();
const page = await context.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('URL inicial:', page.url());

process.stdin.setEncoding('utf8');
process.stdin.resume();

process.stdin.once('data', async () => {
  try {
    await context.storageState({ path: 'data/storageState.json' });
    fs.chmodSync('data/storageState.json', 0o600);
    console.log('Sessão salva em data/storageState.json');
  } finally {
    await browser.close();
    process.exit(0);
  }
});
