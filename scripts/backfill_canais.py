#!/usr/bin/env python3
"""Preenche `canais` no frontmatter dos posts a partir das tags existentes.

As tags históricas têm grafias diferentes para o mesmo canal. A tabela
ALIASES converge essas variantes para os termos canônicos da taxonomia. Posts
com transmissão conjunta recebem todos os canais encontrados, na ordem das
tags.

O script resolve o corpus inteiro antes de escrever qualquer arquivo. Se um
post não tiver exatamente uma decisão (`canais` encontrados ou override
explícito), nada é alterado.

Uso:
    python3 scripts/backfill_canais.py            # confere e escreve
    python3 scripts/backfill_canais.py --dry-run  # só confere
"""

import argparse
import os
import re
import sys


POSTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content", "posts"
)

ALIASES = {
    "Canal-GOAT": "Canal GOAT",
    "CazeTV": "CazeTV",
    "CazéTV": "CazeTV",
    "GETV": "GETV",
    "SBT Sports": "SBT Sports",
    "SBT-Sports": "SBT Sports",
    "SportyNet": "SportyNet",
    "Xsports": "Xsports",
}

# Reservado para posts institucionais futuros que não pertençam a canal algum.
# O valor deve ser None para renderizar `sem_canal = true`.
OVERRIDES = {}

TAGS_RE = re.compile(r"^tags\s*=\s*\[(.*)\]\s*$")
ITEM_RE = re.compile(r"""['\"]([^'\"]*)['\"]""")
CATEGORIES_RE = re.compile(r"^categories\s*=")


class Unresolved(Exception):
    pass


def read_lines(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read().split("\n")


def frontmatter_bounds(lines):
    if not lines or lines[0].strip() != "+++":
        raise Unresolved("frontmatter não começa com +++")
    for i in range(1, len(lines)):
        if lines[i].strip() == "+++":
            return 0, i
    raise Unresolved("frontmatter não fechado")


def tags(lines, start, end):
    for i in range(start + 1, end):
        match = TAGS_RE.match(lines[i].strip())
        if match:
            items = ITEM_RE.findall(match.group(1))
            if items:
                return items
            raise Unresolved("linha `tags` vazia ou ilegível")
    raise Unresolved("sem linha `tags`")


def resolve(slug, lines, start, end):
    if slug in OVERRIDES:
        return OVERRIDES[slug]

    found = []
    for tag in tags(lines, start, end):
        canonical = ALIASES.get(tag)
        if canonical and canonical not in found:
            found.append(canonical)
    if not found:
        raise Unresolved("nenhuma tag corresponde a um canal conhecido")
    return found


def render(channels):
    if channels is None:
        return "sem_canal = true"
    quoted = ", ".join("'%s'" % channel for channel in channels)
    return "canais = [%s]" % quoted


def apply(lines, start, end, new_line):
    for i in range(start + 1, end):
        if CATEGORIES_RE.match(lines[i].strip()):
            return lines[: i + 1] + [new_line] + lines[i + 1 :]
    raise Unresolved("sem linha `categories` para ancorar a inserção")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    slugs = sorted(
        directory
        for directory in os.listdir(POSTS_DIR)
        if os.path.isfile(os.path.join(POSTS_DIR, directory, "index.md"))
    )

    planned = []
    problems = []
    skipped = []

    for slug in slugs:
        path = os.path.join(POSTS_DIR, slug, "index.md")
        lines = read_lines(path)
        try:
            start, end = frontmatter_bounds(lines)
            head = "\n".join(lines[start:end])
            if re.search(r"^(?:canais|sem_canal)\s*=", head, re.MULTILINE):
                skipped.append(slug)
                continue
            channels = resolve(slug, lines, start, end)
            updated = apply(lines, start, end, render(channels))
            planned.append((slug, path, updated, channels))
        except Unresolved as exc:
            problems.append((slug, str(exc)))

    if problems:
        print("Não consegui resolver %d post(s). NADA foi escrito." % len(problems))
        print("Decida caso a caso e adicione a OVERRIDES ou a ALIASES:\n")
        for slug, why in problems:
            print("  %s\n      %s" % (slug, why))
        return 1

    counts = {}
    no_channel = 0
    for _, _, _, channels in planned:
        if channels is None:
            no_channel += 1
        else:
            for channel in channels:
                counts[channel] = counts.get(channel, 0) + 1

    print("%d post(s) a preencher, %d já preenchido(s)." % (len(planned), len(skipped)))
    for channel in sorted(counts):
        print("  %-16s %d" % (channel, counts[channel]))
    print("  %-16s %d" % ("(sem canal)", no_channel))

    if args.dry_run:
        print("\n--dry-run: nada escrito.")
        return 0

    for _, path, updated, _ in planned:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(updated))

    print("\nEscrito. Revise com `git diff` antes de commitar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
