#!/usr/bin/env bash
# Publica a conversora em um domínio com HTTPS, de ponta a ponta:
# vhost do Nginx -> certificado Let's Encrypt -> verificação.
#
# Uso:
#   sudo bash deploy/setup-https.sh pdf.seudominio.com.br
#
# Idempotente: pode rodar de novo à vontade. Não toca em nenhum outro site do
# Nginx — cria/atualiza apenas o vhost "html2pdf".

set -euo pipefail

DOMAIN="${1:-}"
SITE_NAME="html2pdf"
AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[ -n "$DOMAIN" ] || die "informe o domínio. Ex.: sudo bash deploy/setup-https.sh pdf.seudominio.com.br"
[ "$(id -u)" -eq 0 ] || die "rode com sudo."
command -v nginx >/dev/null || die "nginx não encontrado (sudo apt install nginx)."
command -v certbot >/dev/null || die "certbot não encontrado (sudo apt install certbot python3-certbot-nginx)."

# --- 0. A configuração atual do Nginx está sã? --------------------------------
# Se já houver algo quebrado (tipicamente um vhost apontando para certificado
# que foi apagado), qualquer 'nginx -t' falha e nada aqui adianta.
info "Validando a configuração atual do Nginx"
if ! nginx -t 2>/tmp/setup-https-nginx.err; then
  cat /tmp/setup-https-nginx.err >&2
  echo >&2
  echo "A configuração do Nginx JÁ ESTAVA quebrada antes deste script." >&2
  MISSING=0
  while IFS=: read -r file line rest; do
    certpath="$(echo "$rest" | sed -E 's/.*ssl_certificate(_key)?[[:space:]]+([^;]+);.*/\2/')"
    if [ -n "$certpath" ] && [ ! -f "$certpath" ]; then
      echo "  $file:$line aponta para um certificado inexistente: $certpath" >&2
      MISSING=1
    fi
  done < <(grep -rn "ssl_certificate" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null || true)
  if [ "$MISSING" = "1" ]; then
    echo >&2
    echo "Remova as linhas acima (e o 'listen 443 ssl' do mesmo bloco, se ele" >&2
    echo "ficar sem certificado), rode 'sudo nginx -t' e chame este script de novo." >&2
  fi
  die "corrija a configuração existente antes de continuar."
fi

# --- 1. O serviço está de pé no localhost? ------------------------------------
info "Checando a conversora em 127.0.0.1:3000"
HEALTH="$(curl -fsS --max-time 5 http://127.0.0.1:3000/health || true)"
[ -n "$HEALTH" ] || die "sem resposta em http://127.0.0.1:3000/health. Rode 'docker compose up -d' primeiro."
echo "    $HEALTH"
case "$HEALTH" in
  *'"auth":true'*) ;;
  *)
    echo "    Sem API_KEY: publicar assim deixa a conversora aberta para qualquer um" >&2
    echo "    que alcance o domínio, inclusive para buscar URLs da sua rede interna." >&2
    echo "    Defina API_KEY no .env e rode 'docker compose up -d'." >&2
    [ "${ALLOW_NO_AUTH:-}" = "1" ] || die "abortando. Para publicar mesmo assim: ALLOW_NO_AUTH=1 sudo -E bash $0 $DOMAIN"
    echo "    ALLOW_NO_AUTH=1 definido — seguindo sem autenticação."
    ;;
esac

# --- 2. O DNS aponta para algum lugar? ----------------------------------------
info "Resolvendo $DOMAIN"
RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | paste -sd' ' || true)"
[ -n "$RESOLVED" ] || die "$DOMAIN não resolve. Crie o registro A apontando para $(curl -4 -fsS --max-time 5 ifconfig.me || echo 'o IP da VM')."
echo "    $RESOLVED"

# --- 3. Vhost HTTP (necessário para o desafio do certbot) ---------------------
info "Escrevendo $AVAILABLE"
sed "s/pdf\.seudominio\.com\.br/${DOMAIN}/g" "${SCRIPT_DIR}/nginx.conf.example" > "$AVAILABLE"
ln -sfn "$AVAILABLE" "$ENABLED"
nginx -t
systemctl reload nginx

# --- 4. Certificado -----------------------------------------------------------
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  info "Certificado de $DOMAIN já existe, reaproveitando"
else
  info "Emitindo certificado para $DOMAIN"
  certbot --nginx -d "$DOMAIN" --redirect
fi

# --- 5. Garantir que o certificado está NESTE vhost ---------------------------
# O certbot instala o certificado no site "default" quando não casa o
# server_name; nesse caso aplicamos o vhost HTTPS completo por conta própria.
if ! grep -q "ssl_certificate" "$AVAILABLE"; then
  info "Certificado não ficou no vhost da conversora; aplicando o template HTTPS"
  sed "s/pdf\.seudominio\.com\.br/${DOMAIN}/g" "${SCRIPT_DIR}/nginx-ssl.conf.example" > "$AVAILABLE"
  nginx -t
  systemctl reload nginx
fi

# --- 6. Verificação final -----------------------------------------------------
info "Testando https://${DOMAIN}/health"
RESP="$(curl -fsS --max-time 15 "https://${DOMAIN}/health" || true)"
if [ -z "$RESP" ]; then
  die "o domínio não respondeu. Veja: sudo nginx -T | grep -n '${DOMAIN}' e sudo tail /var/log/nginx/error.log"
fi
echo "    $RESP"
case "$RESP" in
  *'"status":"ok"'*) echo; info "Pronto: https://${DOMAIN}/convert" ;;
  *) die "resposta inesperada — provavelmente o domínio está caindo em outro server block." ;;
esac
