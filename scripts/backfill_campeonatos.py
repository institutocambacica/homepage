#!/usr/bin/env python3
"""Preenche `campeonatos` e `data_evento` no frontmatter dos posts.

Duas fontes, e SOMENTE duas:

  * a última entrada de `tags`, resolvida pela tabela ALIASES abaixo;
  * o ano do prefixo AAAA-MM-DD do diretório do bundle, que é a data do evento.

O campo `date` do frontmatter NÃO serve: ele é a data de publicação, e 70 dos
75 posts divergem dela (o lote de Nov/Dez 2025 só foi publicado em Jul 2026).

REGRA CENTRAL: nunca adivinhar. Se um post não se resolve pelas duas fontes
acima, o script não escreve NADA em disco — nem nesse post, nem nos outros —
imprime o relatório do que não conseguiu resolver e sai com código 1. A decisão
é humana.

Uso:
    python3 scripts/backfill_campeonatos.py            # confere e escreve
    python3 scripts/backfill_campeonatos.py --dry-run  # só confere
"""

import argparse
import os
import re
import sys

POSTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content", "posts"
)

# Sentinela: post que deliberadamente não pertence a campeonato nenhum.
SEM_CAMPEONATO = object()

# Última tag (como está no disco) -> nome-base canônico, ASCII e sem acento.
# O termo final é "<base> <ano do diretório>". O nome bonito e acentuado mora
# no title de content/campeonatos/<slug>/_index.md, nunca aqui.
#
# Note as duplicatas de grafia que já existem no corpus (Brasileirão/Brasileirao,
# Sul-Americana/Sulamericana): é justamente o que esta tabela funde.
ALIASES = {
    "Brasileirão": "Brasileirao",
    "Brasileirao": "Brasileirao",
    "Brasileirão Feminino": "Brasileirao Feminino",
    "Serie-B": "Serie B",
    "Serie-C": "Serie C",
    "Paulistão Feminino": "Paulistao Feminino",
    "Copa do Brasil": "Copa do Brasil",
    "Libertadores": "Libertadores",
    "Sul-Americana": "Sul-Americana",
    "Sulamericana": "Sul-Americana",
    "Mundial de Clubes": "Mundial de Clubes",
    "Copa do Mundo": "Copa do Mundo",
    "Eliminatórias": "Eliminatorias",
    "LaLiga": "LaLiga",
    "Copa da Italia": "Copa da Italia",
    "Copa Argentina": "Copa Argentina",
    "Campeonato Mexicano": "Campeonato Mexicano",
    "Supercopa da Franca": "Supercopa da Franca",
    "NFL": "NFL",
    "Amistoso": "Amistosos",
    "Premiacao": "Premiacoes",
}

# 'Avisos' está fora da tabela DE PROPÓSITO: é uma tag de nota institucional,
# não de competição. Qualquer post novo terminando em 'Avisos' vai cair no
# relatório de não-resolvidos, que é exatamente o comportamento desejado.

# Posts em que a última tag não é a competição. Lista explícita por caminho —
# nunca heurística.
OVERRIDES = {
    # Nota sobre dados perdidos da Semana 2 da NFL: não há medição a listar.
    "2025-09-15-nota-oficial-nfl-semana-2": SEM_CAMPEONATO,
    # Nota institucional sobre a interrupção das medições.
    "2026-07-13-nossas-sinceras-desculpas": SEM_CAMPEONATO,
    # Última tag é 'Copa do Mundo', mas é um documento de resumo, não um jogo.
    "2026-07-27-um-resumo-caze-na-copa": "Copa do Mundo 2026",
    # Post antigo, sem tag de time e sem 'Audiência'.
    "2025-09-05-nfl-no-brasil": "NFL 2025",
}

DIR_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-")
TAGS_RE = re.compile(r"^tags\s*=\s*\[(.*)\]\s*$")
ITEM_RE = re.compile(r"""['"]([^'"]*)['"]""")
CATEGORIES_RE = re.compile(r"^categories\s*=")


class Unresolved(Exception):
    pass


def read_lines(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read().split("\n")


def frontmatter_bounds(lines, path):
    """Índices das linhas '+++' de abertura e fechamento."""
    if not lines or lines[0].strip() != "+++":
        raise Unresolved("frontmatter não começa com +++")
    for i in range(1, len(lines)):
        if lines[i].strip() == "+++":
            return 0, i
    raise Unresolved("frontmatter não fechado")


def last_tag(lines, start, end, path):
    for i in range(start + 1, end):
        m = TAGS_RE.match(lines[i].strip())
        if m:
            items = ITEM_RE.findall(m.group(1))
            if not items:
                raise Unresolved("linha `tags` vazia ou ilegível")
            return items[-1]
    raise Unresolved("sem linha `tags`")


def resolve(slug, lines, start, end, path):
    """Devolve (termo_ou_SEM_CAMPEONATO, data_evento). Levanta Unresolved."""
    m = DIR_RE.match(slug)
    if not m:
        raise Unresolved(
            "o diretório não começa com AAAA-MM-DD, então não há data de evento confiável"
        )
    ano = m.group(1)
    data_evento = "%s-%s-%s" % (m.group(1), m.group(2), m.group(3))

    if slug in OVERRIDES:
        return OVERRIDES[slug], data_evento

    tag = last_tag(lines, start, end, path)
    base = ALIASES.get(tag)
    if base is None:
        raise Unresolved(
            "última tag %r não está na tabela ALIASES — competição desconhecida "
            "ou tag que não é competição" % tag
        )
    return "%s %s" % (base, ano), data_evento


def render(termo, data_evento):
    if termo is SEM_CAMPEONATO:
        campo = "sem_campeonato = true"
    else:
        campo = "campeonatos = ['%s']" % termo
    return [campo, "data_evento = %s" % data_evento]


def apply(lines, start, end, novas):
    """Insere as linhas novas logo após `categories`."""
    for i in range(start + 1, end):
        if CATEGORIES_RE.match(lines[i].strip()):
            return lines[: i + 1] + novas + lines[i + 1 :]
    raise Unresolved("sem linha `categories` para ancorar a inserção")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    slugs = sorted(
        d
        for d in os.listdir(POSTS_DIR)
        if os.path.isfile(os.path.join(POSTS_DIR, d, "index.md"))
    )

    planned = []
    problems = []
    skipped = []

    # --- passo 1: resolver tudo antes de tocar em qualquer arquivo ---
    for slug in slugs:
        path = os.path.join(POSTS_DIR, slug, "index.md")
        lines = read_lines(path)
        try:
            start, end = frontmatter_bounds(lines, path)
            head = "\n".join(lines[start:end])
            if "campeonatos" in head or "sem_campeonato" in head or "data_evento" in head:
                skipped.append(slug)
                continue
            termo, data_evento = resolve(slug, lines, start, end, path)
            novas = render(termo, data_evento)
            planned.append((slug, path, apply(lines, start, end, novas), termo))
        except Unresolved as exc:
            problems.append((slug, str(exc)))

    # --- passo 2: se algo ficou de fora, não escreve nada ---
    if problems:
        print("Não consegui resolver %d post(s). NADA foi escrito." % len(problems))
        print("Decida caso a caso e adicione a OVERRIDES ou a ALIASES:\n")
        for slug, why in problems:
            print("  %s\n      %s" % (slug, why))
        return 1

    termos = {}
    for _, _, _, termo in planned:
        if termo is not SEM_CAMPEONATO:
            termos[termo] = termos.get(termo, 0) + 1

    print("%d post(s) a preencher, %d já preenchido(s)." % (len(planned), len(skipped)))
    print("%d termo(s):" % len(termos))
    for termo in sorted(termos):
        print("  %-32s %d" % (termo, termos[termo]))
    sem = sum(1 for _, _, _, t in planned if t is SEM_CAMPEONATO)
    print("  %-32s %d" % ("(sem campeonato)", sem))

    if args.dry_run:
        print("\n--dry-run: nada escrito.")
        return 0

    for _, path, novas_linhas, _ in planned:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(novas_linhas))

    print("\nEscrito. Revise com `git diff` antes de commitar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
