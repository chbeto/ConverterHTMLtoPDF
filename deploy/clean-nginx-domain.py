#!/usr/bin/env python3
"""Remove de um arquivo de configuração do Nginx tudo que se refere a um domínio.

Apagar as linhas com `sed` quebra a configuração: o certbot escreve blocos
`if ($host = dominio) { ... }`, e remover só a linha de abertura deixa a chave
de fechamento órfã ("listen directive is not allowed here").

Este script entende as chaves e faz a remoção bloco a bloco:

  - blocos `if ($host = DOMINIO)` são removidos inteiros;
  - linhas ssl_certificate/ssl_certificate_key que apontam para o certificado
    do domínio são removidas — e, se o bloco ficar sem certificado, os
    `listen ... ssl` e as linhas de SSL do certbot vão junto;
  - o domínio some do `server_name`; se ele era o único nome, o bloco inteiro
    é removido, a menos que seja um `default_server` (nesse caso vira `_`).

Uso:
    python3 deploy/clean-nginx-domain.py DOMINIO ARQUIVO          # mostra o resultado
    sudo python3 deploy/clean-nginx-domain.py DOMINIO ARQUIVO -i  # aplica (faz .bak)
"""

import re
import shutil
import sys


def split_top_level(text):
    """Quebra o texto em pedaços de primeiro nível, respeitando as chaves."""
    parts, buf, depth = [], [], 0
    for ch in text:
        buf.append(ch)
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                parts.append("".join(buf))
                buf = []
    if buf:
        parts.append("".join(buf))
    return parts


def drop_if_host_blocks(block, domain):
    """Remove blocos `if ($host = dominio) { ... }` inteiros."""
    pattern = re.compile(r"[ \t]*if\s*\(\s*\$host\s*=\s*" + re.escape(domain) + r"\b[^)]*\)\s*\{")
    while True:
        match = pattern.search(block)
        if not match:
            return block
        depth, i = 0, match.end() - 1
        while i < len(block):
            if block[i] == "{":
                depth += 1
            elif block[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        end = block.find("\n", i)
        end = len(block) if end == -1 else end + 1
        block = block[: match.start()] + block[end:]


def clean_server_block(block, domain):
    """Devolve o bloco limpo, ou None quando ele deve sumir por completo."""
    block = drop_if_host_blocks(block, domain)
    lines = block.split("\n")

    cert_re = re.compile(r"^\s*ssl_certificate(_key)?\s+\S*/live/" + re.escape(domain) + r"/")
    kept = [ln for ln in lines if not cert_re.match(ln)]
    removed_cert = len(kept) != len(lines)

    has_cert = any(re.match(r"^\s*ssl_certificate\s", ln) for ln in kept)
    is_default = any("default_server" in ln for ln in kept if re.match(r"^\s*listen\s", ln))

    # Bloco ficou sem certificado: tira o que depende dele, senão o nginx recusa.
    if removed_cert and not has_cert:
        cleaned = []
        for ln in kept:
            if re.match(r"^\s*listen\s", ln) and re.search(r"\bssl\b", ln):
                continue
            if "options-ssl-nginx.conf" in ln or re.match(r"^\s*ssl_dhparam\s", ln):
                continue
            cleaned.append(ln)
        kept = cleaned

    # Tira o domínio dos server_name.
    out, drop_block = [], False
    for ln in kept:
        m = re.match(r"^(\s*)server_name\s+([^;]+);(.*)$", ln)
        if not m:
            out.append(ln)
            continue
        indent, names, tail = m.group(1), m.group(2).split(), m.group(3)
        names = [n for n in names if n != domain]
        if names:
            out.append(f"{indent}server_name {' '.join(names)};{tail}")
        elif is_default:
            out.append(f"{indent}server_name _;")
        else:
            drop_block = True

    if drop_block:
        return None
    if not any(re.match(r"^\s*listen\s", ln) for ln in out):
        return None
    return "\n".join(out)


def main():
    args = [a for a in sys.argv[1:] if a != "-i"]
    in_place = "-i" in sys.argv[1:]
    if len(args) != 2:
        print(__doc__.strip())
        return 2

    domain, path = args
    with open(path, encoding="utf-8") as fh:
        original = fh.read()

    result = []
    for part in split_top_level(original):
        start = re.search(r"^[ \t]*server\s*\{", part, re.M)
        if domain in part and start:
            # Tudo que vem antes do bloco (comentários, outras diretivas) é
            # preservado mesmo quando o bloco inteiro é descartado.
            prefix, body = part[: start.start()], part[start.start() :]
            result.append(prefix)
            cleaned = clean_server_block(body, domain)
            if cleaned is not None:
                result.append(cleaned)
        else:
            result.append(part)
    output = "".join(result)

    if not in_place:
        sys.stdout.write(output)
        print(f"\n--- prévia; use -i para aplicar em {path} ---", file=sys.stderr)
        return 0

    shutil.copy2(path, path + ".bak")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(output)
    print(f"{path} atualizado (backup em {path}.bak)")
    if domain in output:
        print(f"AVISO: ainda há menções a {domain} no arquivo; revise à mão.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
