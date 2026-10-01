# NestEx Faucet Bot

Automacao para uma conta propria no NestEx. Mantem a sessao do navegador e verifica a pagina de faucets a cada hora para acionar controles de coleta disponiveis.

## Instalacao

npm install
npx playwright install chromium

## Primeiro login

npm run login

Faca login manualmente no navegador que abrir e pressione ENTER no terminal.

## Executar

npm start

O processo roda imediatamente e depois a cada 60 minutos.

## Seguranca

Nao armazene senhas, cookies ou tokens no repositorio. A sessao local fica ignorada pelo Git.
