# Converter HTML to PDF

API HTTP self-hosted que **converte HTML em PDF** e devolve o arquivo
**direto para download**. Sem banco de dados e sem estado: você envia o HTML,
recebe o PDF na resposta. Feita para ser chamada por automações como o **n8n**
(nó *HTTP Request*), mas funciona com qualquer cliente HTTP.

A renderização usa **Puppeteer (Chrome headless)** sobre a imagem oficial do
Puppeteer, que já inclui o Chrome e todas as bibliotecas de sistema — sem dor
de cabeça com `libnss3` e afins.

---

## Sumário
- [Pré-requisitos](#pré-requisitos)
- [Como publicar (Docker)](#como-publicar-docker)
- [Abrindo para conexões externas](#abrindo-para-conexões-externas)
- [Endpoints](#endpoints)
- [Integração com o n8n](#integração-com-o-n8n)
- [Opções de PDF](#opções-de-pdf)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Rodando sem Docker](#rodando-sem-docker-nodepm2)
- [Operação e troubleshooting](#operação-e-troubleshooting)

---

## Pré-requisitos

- Um servidor/VM Linux (qualquer provedor) com **Docker** e **Docker Compose**.
- Porta `3000` livre (configurável).

> Recomenda-se pelo menos **1 vCPU / 1 GB de RAM**. O Chrome headless é
> relativamente leve por requisição, mas picos de conversões simultâneas
> consomem CPU/memória.

---

## Como publicar (Docker)

```bash
git clone https://github.com/chbeto/ConverterHTMLtoPDF.git
cd ConverterHTMLtoPDF
docker compose up -d --build
```

Pronto. Verifique:

```bash
curl http://localhost:3000/health      # {"status":"ok", ...}
```

Comandos úteis:

```bash
docker compose logs -f     # acompanhar logs
docker compose restart     # reiniciar
docker compose down        # parar e remover o container
docker compose up -d --build   # aplicar atualizações após um git pull
```

### Atualizando para uma nova versão

```bash
cd ConverterHTMLtoPDF
git pull
docker compose up -d --build
```

---

## Abrindo para conexões externas

Por padrão a porta é publicada **apenas no localhost da VM**
(`127.0.0.1:3000`), pensando no cenário em que o n8n está na mesma máquina.
Para receber chamadas de fora, escolha um dos dois caminhos abaixo.

Antes de qualquer coisa, crie o `.env`:

```bash
cp .env.example .env
openssl rand -hex 32        # copie o resultado para API_KEY no .env
```

> **Sempre defina `API_KEY` ao expor externamente.** Sem ela, qualquer pessoa que
> alcance a porta gera PDFs no seu servidor — e o HTML enviado pode fazer o
> Chrome buscar URLs internas da sua rede (imagens, `iframe`, `fetch`) e embutir
> o resultado no PDF. O serviço loga na subida se estiver sem autenticação.

### Opção A — Nginx com HTTPS (recomendado)

O container continua fechado no `127.0.0.1` e só o Nginx fica exposto (80/443),
com certificado válido.

**Pré-requisito:** um registro **A** do subdomínio apontando para o IP público
da VM (`curl -4 ifconfig.me`). Confira com `dig +short SEU.DOMINIO` antes de
seguir — sem isso o certbot falha com `NXDOMAIN`.

Com o DNS no ar, um comando faz o resto (vhost + certificado + verificação):

```bash
sudo bash deploy/setup-https.sh pdf.seudominio.com.br
```

O script checa o serviço no `127.0.0.1:3000`, resolve o DNS, escreve o vhost,
chama o certbot e confirma no fim que `https://SEU.DOMINIO/health` responde.
É idempotente e mexe só no vhost `html2pdf`, sem tocar nos outros sites da VM.

<details>
<summary>Fazendo na mão</summary>

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/html2pdf
sudo nano /etc/nginx/sites-available/html2pdf     # troque o server_name
sudo ln -sfn /etc/nginx/sites-available/html2pdf /etc/nginx/sites-enabled/html2pdf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pdf.seudominio.com.br
```
</details>

No `.env`, mantenha `BIND_ADDRESS=127.0.0.1` e defina `TRUST_PROXY=1` (para o
IP real do cliente aparecer nos logs). Aplique com `docker compose up -d`.

Teste de fora da VM:
```bash
curl https://pdf.seudominio.com.br/health
curl -X POST https://pdf.seudominio.com.br/convert \
  -H "Content-Type: application/json" -H "x-api-key: SUA_CHAVE" \
  -d '{"html":"<h1>Teste</h1>"}' --output teste.pdf
```

> **Se o certbot disser `deployed certificate to .../sites-enabled/default`**,
> ele não achou o bloco da conversora e colocou o certificado no site padrão —
> o domínio vai responder **404**. Use o vhost pronto de HTTPS:
>
> ```bash
> sudo cp deploy/nginx-ssl.conf.example /etc/nginx/sites-available/html2pdf
> sudo sed -i 's/pdf.seudominio.com.br/SEU.DOMINIO.COM.BR/g' \
>      /etc/nginx/sites-available/html2pdf
> sudo ln -sf /etc/nginx/sites-available/html2pdf /etc/nginx/sites-enabled/html2pdf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> Não é preciso mexer no site `default` (onde costumam morar os outros serviços
> da VM): o Nginx casa o `server_name` antes de cair no `default_server`.

### Trocando o domínio / recomeçando do zero

Se um domínio errado chegou a ser configurado, limpe **nesta ordem** (remover o
certificado antes de tirar as referências dele quebra o `nginx -t`):

```bash
# 1. Backup dos configs
sudo cp -a /etc/nginx/sites-available /root/nginx-backup-$(date +%F-%H%M)

# 2. Onde o domínio antigo aparece?
sudo grep -rn "dominio-antigo" /etc/nginx/sites-available/ /etc/nginx/sites-enabled/

# 3. Tire as linhas do domínio antigo (o certbot pode ter escrito no site
#    'default'; apague só as linhas dele, preservando os outros serviços)
sudo nano /etc/nginx/sites-available/default
sudo rm -f /etc/nginx/sites-enabled/html2pdf /etc/nginx/sites-available/html2pdf

# 4. Valide ANTES de remover o certificado
sudo nginx -t && sudo systemctl reload nginx

# 5. Agora sim, remova o certificado órfão
sudo certbot certificates                       # lista o que existe
sudo certbot delete --cert-name dominio-antigo

# 6. Apague o registro DNS antigo no painel e crie o novo
```

> Se o certificado já foi apagado **antes** dos passos 3 e 4, o `nginx -t` passa
> a falhar com `cannot load certificate ... No such file or directory` e nenhum
> site recarrega. É o mesmo conserto: tire as linhas órfãs e valide de novo.

Depois é só rodar o setup com o domínio certo:

```bash
sudo bash deploy/setup-https.sh pdf.seudominio.com.br
```

### Domínio atrás do Cloudflare

Se o DNS estiver **proxied** (nuvem laranja — o `dig` devolve IPs `104.x`/`172.67.x`
em vez do IP da VM), tudo funciona, com dois ajustes:

- Em *SSL/TLS → Overview*, use **Full (strict)**. Em modo *Flexible* o Cloudflare
  fala HTTP com a origem e o redirect 80→443 vira loop.
- O Cloudflare corta conexões em ~100s (erro **524**). Conversões muito pesadas
  podem estourar isso; nesse caso, use um subdomínio **DNS only** (nuvem cinza)
  para a conversora.

### Opção B — publicar a porta direto

Sem domínio/HTTPS, expondo a `3000` na internet. No `.env`:

```env
BIND_ADDRESS=0.0.0.0
HOST_PORT=3000
API_KEY=sua_chave_gerada
```

```bash
docker compose up -d
sudo ufw allow 3000/tcp     # se o provedor também tiver firewall, libere lá
```

> ⚠️ **O `ufw` não protege portas publicadas pelo Docker.** O Docker escreve
> regras de NAT no iptables que são avaliadas **antes** do ufw, então um
> `ufw deny 3000` é ignorado — quem manda é o `BIND_ADDRESS`. Para fechar de
> novo, volte para `127.0.0.1` e rode `docker compose up -d`.
>
> Nessa opção o tráfego (inclusive a `x-api-key`) trafega em HTTP puro. Prefira
> a Opção A sempre que houver um domínio disponível.

### Chamando de fora

Todas as requisições a `/convert` precisam da chave quando `API_KEY` está
definida — via header `x-api-key` ou `Authorization: Bearer`:

```bash
curl -X POST http://SEU_IP:3000/convert \
  -H "Content-Type: application/json" \
  -H "x-api-key: SUA_CHAVE" \
  -d '{"html":"<h1>Teste</h1>","filename":"teste.pdf"}' \
  --output teste.pdf
```

`GET /health` fica aberto de propósito (healthcheck de proxy) e não devolve
nada sensível. A página de teste em `/` mostra um campo para a chave quando o
servidor exige autenticação.

### Chamadas a partir de um navegador (CORS)

Se uma página em outro domínio for chamar a API via `fetch`, libere a origem:

```env
CORS_ORIGIN=https://app.exemplo.com     # lista separada por vírgula, ou *
```

Sem isso, apenas clientes server-side (n8n, cURL, backends) conseguem chamar.

---

## Endpoints

### `GET /health`
Verificação de saúde. Retorna `{ "status": "ok" }`.

### `POST /convert`
Converte e devolve o PDF no corpo da resposta (`application/pdf`,
`Content-Disposition: attachment`).

**Corpo (JSON):**
```json
{
  "html": "<h1>Olá mundo</h1><p>Meu primeiro PDF</p>",
  "filename": "relatorio.pdf",
  "options": {
    "format": "A4",
    "landscape": false,
    "printBackground": true,
    "margin": { "top": "1cm", "right": "1cm", "bottom": "1cm", "left": "1cm" }
  }
}
```

| Campo      | Obrigatório | Descrição                                  |
|------------|-------------|--------------------------------------------|
| `html`     | sim         | HTML completo a ser renderizado            |
| `filename` | não         | Nome do arquivo PDF (padrão `documento.pdf`) |
| `options`  | não         | Opções de PDF (veja a tabela mais abaixo)  |

Também aceita o HTML puro no corpo com `Content-Type: text/html`.

**Teste rápido (cURL):**
```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Teste</h1>","filename":"teste.pdf"}' \
  --output teste.pdf
```

### Página de teste
Acesse `http://SEU_HOST:3000/` para um formulário simples de colar HTML, gerar
e baixar o PDF.

---

## Integração com o n8n

Escolha o cenário:

- **n8n na mesma VM** → seções 1 e 2 abaixo (rede Docker, sem passar pela internet).
- **n8n em outra VM** → pule para [n8n em outra VM](#3-n8n-em-outra-vm).

### 1. Conectar a conversora à rede do n8n (n8n em Docker)

Para o n8n chamar a conversora **pelo nome do container** (sem depender de IP),
os dois precisam estar na mesma rede Docker. Descubra a rede do n8n:

```bash
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' NOME_DO_CONTAINER_N8N
```

O `docker-compose.yml` deste projeto já está configurado para entrar na rede
externa **`n8n_default`** (padrão de stacks do n8n). Se a sua rede tiver outro
nome, ajuste o final do arquivo:

```yaml
networks:
  n8n_net:
    external: true
    name: n8n_default   # <- troque pelo nome da sua rede
```

Depois aplique e confirme:
```bash
docker compose up -d --build
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' converter-html-to-pdf
# deve listar a rede do n8n
```

Teste a partir de dentro do container do n8n:
```bash
docker exec NOME_DO_CONTAINER_N8N wget -qO- http://converter-html-to-pdf:3000/health
```

### 2. Configurar o nó HTTP Request

- **Method:** `POST`
- **URL:**
  - n8n em Docker (mesma rede): `http://converter-html-to-pdf:3000/convert`
  - n8n fora de Docker, mesma VM: `http://localhost:3000/convert`
- **Body Content Type:** `JSON`
- **Specify Body → Using JSON**, com uma **expressão** (evita erro de JSON
  inválido quando o HTML tem quebras de linha):
  ```
  {{ { "html": $json.htmlCompleto, "filename": "proposta.pdf" } }}
  ```
- **Options → Response → Response Format:** **File** (binário).

O PDF chega como dado binário e pode seguir para *Write Binary File*, e-mail,
Google Drive, Telegram, etc.

> **Dica:** se montar o corpo manualmente em texto e o HTML tiver quebras de
> linha, o n8n acusa "not valid JSON". Use a forma de objeto/expressão acima,
> que serializa e escapa tudo automaticamente.

### 3. n8n em outra VM

Aqui a rede Docker não ajuda: a chamada sai pela internet. Publique a conversora
pela [Opção A](#opção-a--nginx-com-https-recomendado) (Nginx + HTTPS + `API_KEY`)
e aponte o n8n para o domínio.

**Antes de mexer no n8n**, confirme da VM do n8n que o serviço responde:

```bash
curl https://pdfconv.seudominio.com.br/health
# {"status":"ok","uptime":...,"auth":true}   <- auth:true confirma a API_KEY ativa
```

Se `auth` vier `false`, o `.env` não foi lido: confira `API_KEY` no `.env` da VM
da conversora e rode `docker compose up -d`.

**a) Credencial (guarda a chave fora do workflow)**

*Credentials → New → Header Auth*:

| Campo  | Valor                        |
|--------|------------------------------|
| Name   | `x-api-key`                  |
| Value  | a chave gerada com `openssl rand -hex 32` |

Dê um nome tipo `HTML2PDF – API Key`.

**b) Nó HTTP Request**

- **Method:** `POST`
- **URL:** `https://pdfconv.seudominio.com.br/convert`
- **Authentication:** `Generic Credential Type` → `Header Auth` → a credencial criada
- **Body Content Type:** `JSON` → *Specify Body → Using JSON*, com expressão:
  ```
  {{ { "html": $json.htmlCompleto, "filename": "proposta.pdf" } }}
  ```
- **Options → Response → Response Format:** **File** (binário)
- **Options → Timeout:** `120000` (ms) — HTML pesado pode passar dos 30s padrão

Sempre `https://`. Em HTTP puro a chave viajaria em texto claro pela internet.

---

## Opções de PDF

Repassadas ao Puppeteer dentro de `options`:

| Campo                 | Descrição                                   | Padrão        |
|-----------------------|---------------------------------------------|---------------|
| `format`              | `A4`, `A3`, `Letter`, etc.                  | `A4`          |
| `landscape`           | Orientação paisagem                         | `false`       |
| `printBackground`     | Imprimir cores/imagens de fundo             | `true`        |
| `margin`              | `{ top, right, bottom, left }`              | `1cm`         |
| `scale`               | Escala de renderização (0.1–2)              | `1`           |
| `displayHeaderFooter` | Exibir cabeçalho/rodapé                     | `false`       |
| `headerTemplate`      | HTML do cabeçalho                           | —             |
| `footerTemplate`      | HTML do rodapé                              | —             |

---

## Variáveis de ambiente

| Variável       | Descrição                                                        | Padrão      |
|----------------|------------------------------------------------------------------|-------------|
| `PORT`         | Porta HTTP                                                       | `3000`      |
| `HOST`         | Interface de escuta do Node (dentro do container, deixe assim)    | `0.0.0.0`   |
| `BODY_LIMIT`   | Tamanho máximo do corpo da requisição                            | `25mb`      |
| `API_KEY`      | Se definida, `/convert` exige o header `x-api-key`               | — (aberto)  |
| `CORS_ORIGIN`  | Origens liberadas para navegador (lista por vírgula, ou `*`)      | — (sem CORS)|
| `TRUST_PROXY`  | Confiar no `X-Forwarded-For` (use `1` atrás de Nginx/Traefik)     | —           |

E, no `docker-compose.yml`, controlando a publicação da porta no host:

| Variável       | Descrição                                                        | Padrão      |
|----------------|------------------------------------------------------------------|-------------|
| `BIND_ADDRESS` | `127.0.0.1` = só a VM · `0.0.0.0` = qualquer origem              | `127.0.0.1` |
| `HOST_PORT`    | Porta publicada no host                                          | `3000`      |

Defina tudo isso no arquivo `.env` na raiz do projeto (`cp .env.example .env`);
o `docker compose` lê esse arquivo automaticamente. Depois de alterar, rode
`docker compose up -d` para aplicar.

---

## Rodando sem Docker (Node/PM2)

Requer Node.js 18+ e as dependências de sistema do Chromium. Em Ubuntu/Debian:
```bash
sudo apt-get update && sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0

git clone https://github.com/chbeto/ConverterHTMLtoPDF.git
cd ConverterHTMLtoPDF
npm install
npm start            # ou: pm2 start npm --name html2pdf -- start
```

---

## Operação e troubleshooting

| Sintoma | Causa provável / solução |
|---------|--------------------------|
| `no configuration file provided: not found` no `docker compose` | Você não está na pasta do projeto, ou está numa branch sem o `docker-compose.yml`. Use a branch `main`. |
| n8n: *"The value in the JSON Body field is not valid JSON"* | HTML com quebras de linha montado como texto. Use a expressão de objeto no body (seção n8n). |
| n8n não conecta (`ECONNREFUSED`/timeout) | n8n em Docker usando `localhost`. Use o nome do container na rede compartilhada: `http://converter-html-to-pdf:3000/convert`. |
| PDF vem corrompido / como texto | Faltou definir **Response Format = File** no nó HTTP Request. |
| certbot: `NXDOMAIN looking up A for ...` | O subdomínio não existe no DNS. Crie um registro **A** apontando para o IP público da VM (`curl -4 ifconfig.me`), confirme com `dig +short SEU_DOMINIO` e rode o certbot de novo. |
| certbot: `Timeout during connect` / falha no desafio | O DNS existe mas a porta 80 não chega até o Nginx. Libere 80 e 443 no firewall do provedor e no `ufw`. |
| `ln: failed to create symbolic link ... File exists` | O symlink do Nginx já estava criado. Pode ignorar — mas confira para onde ele aponta: `ls -la /etc/nginx/sites-enabled/`. |
| `nginx: [emerg] cannot load certificate ... No such file or directory` | O certificado foi apagado mas ainda há um vhost apontando para ele — isso derruba o `nginx -t` inteiro. Ache com `sudo grep -rn "ssl_certificate" /etc/nginx/sites-enabled/` e remova as linhas órfãs (mais o `listen 443 ssl` do bloco, se ele ficar sem certificado). |
| `404 Not Found` do Nginx no domínio, após o certbot | O certificado foi instalado no site `default`. Aplique o `deploy/nginx-ssl.conf.example` (veja a Opção A). |
| Erro **524** / timeout vindo do Cloudflare | Renderização passou de ~100s no proxy do Cloudflare. Use o subdomínio como *DNS only* ou reduza o HTML. |
| Loop de redirecionamento (`ERR_TOO_MANY_REDIRECTS`) | Cloudflare em modo *Flexible*. Troque para **Full (strict)**. |
| Chamada externa dá timeout / não conecta | Porta publicada só no localhost. Defina `BIND_ADDRESS=0.0.0.0` no `.env` (ou use Nginx) e confira também o firewall do provedor (Security Group / Cloud Firewall). |
| `401 Não autorizado` em `/convert` | `API_KEY` está definida e a requisição não mandou o header `x-api-key` (no n8n: *Options → Headers*). |
| Fechei com `ufw deny 3000` e continua acessível | Portas publicadas pelo Docker passam por cima do ufw. Volte `BIND_ADDRESS` para `127.0.0.1` e rode `docker compose up -d`. |
| Navegador acusa erro de CORS | Defina `CORS_ORIGIN` com a origem da página que chama a API. |
| `libnss3.so: cannot open shared object file` | Acontece em ambientes serverless/sem libs. A imagem Docker oficial usada aqui já resolve isso. Rodando sem Docker, instale as libs listadas acima. |

Estrutura do projeto:
```
src/server.js       Servidor Express (POST /convert, GET /health)
lib/pdf.js          Renderização HTML → PDF (Puppeteer)
public/index.html   Página de teste com formulário
scripts/test-local.js  Teste de renderização sem subir o servidor
Dockerfile          Imagem baseada em ghcr.io/puppeteer/puppeteer
docker-compose.yml  Orquestração + rede compartilhada com o n8n
.env.example        Modelo de configuração (exposição, API_KEY, CORS)
deploy/setup-https.sh          Publica em um domínio com HTTPS (vhost + certbot + teste)
deploy/nginx.conf.example      Proxy reverso (HTTP) para o certbot emitir o certificado
deploy/nginx-ssl.conf.example  Vhost HTTPS pronto, para depois da emissão
```
