+++
date = '{{ .Date }}'
draft = true
title = '{{ replace .File.ContentBaseName "-" " " | title }}'
author = 'Instituto Cambacica de Audiência'
summary = ''
tags = ['YouTube', 'Analytics', 'Audiência']
categories = ['Audiência']
# Termo ASCII, sem acento, no formato `Nome AAAA` — ex.: 'Libertadores 2026'.
# Precisa existir content/campeonatos/<slug>/_index.md, senão o build falha.
# Se o post não pertence a campeonato nenhum, troque por: sem_campeonato = true
campeonatos = ['']
# Data do EVENTO, não a de publicação. Preenchida a partir do prefixo
# AAAA-MM-DD do diretório do bundle.
data_evento = {{ substr .File.ContentBaseName 0 10 }}
+++
