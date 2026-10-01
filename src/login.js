import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('data',{recursive:true});
const browser = await chromium.launch({headless:false});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(process.env.NESTEX_URL || 'https://trade.nestex.one/faucets', {waitUntil:'domcontentloaded'});
console.log('Faça login manualmente no navegador. Depois volte ao terminal e pressione ENTER.');
process.stdin.setEncoding('utf8');
process.stdin.once('data', async()=>{
 await context.storageState({path:'data/storageState.json'});
 console.log('Sessão salva em data/storageState.json');
 await browser.close(); process.exit(0);
});
