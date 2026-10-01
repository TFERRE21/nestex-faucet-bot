import Database from 'better-sqlite3';
import fs from 'node:fs';
fs.mkdirSync('data', {recursive:true});
const db = new Database('data/faucets.db');
db.exec(`CREATE TABLE IF NOT EXISTS claims (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 run_at TEXT NOT NULL,
 coin TEXT,
 status TEXT NOT NULL,
 message TEXT,
 url TEXT
);`);
export function logClaim(coin,status,message,url){
 db.prepare('INSERT INTO claims(run_at,coin,status,message,url) VALUES(?,?,?,?,?)')
   .run(new Date().toISOString(),coin,status,message,url);
}
