/*
 * Busca do cabeçalho.
 *
 * O tema injeta este arquivo em themes/typo/layouts/partials/head/js.html com
 * um <script> SEM `defer`, dentro do <head> — ou seja, ele roda antes do DOM
 * existir. Daí o DOMContentLoaded envolvendo tudo.
 *
 * Esse mesmo timing é o que faz a lupa aparecer sem solavanco: a classe
 * `js-search` vai no <html> de forma síncrona, antes de o <body> ser lido, e é
 * ela que dá display ao botão (assets/css/custom.css). Sem JavaScript a classe
 * nunca chega e o gatilho não existe visualmente, que é o comportamento
 * desejado — ele só serve para abrir um modal que o JS monta.
 *
 * O índice (/index.json) só é baixado quando o leitor demonstra intenção de
 * buscar: passar o mouse ou o foco no botão aquece o cache, abrir o overlay
 * garante o download. A busca está em todas as páginas e nenhuma delas deve
 * pagar por ela ao carregar.
 */

(function () {
  'use strict';

  var MAX_RESULTS = 8;
  var DEBOUNCE_MS = 120;

  /* Tempo do fade de saída — precisa bater com a transição de .search-overlay
     em custom.css. Usamos timer e não `transitionend` porque com
     prefers-reduced-motion a transição não acontece e o evento nunca chega. */
  var EXIT_MS = 180;

  /* Acento-insensível: 'brasileirao' precisa achar 'Brasileirão'.
     O bloco U+0300–U+036F cobre til, agudo, circunflexo e a cedilha
     combinante, então 'ç' vira 'c' e 'ã' vira 'a'. */
  function normalize(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  document.documentElement.classList.add('js-search');

  ready(function () {
    var toggle = document.getElementById('search-toggle');
    var overlay = document.getElementById('search-overlay');
    var dialog = document.getElementById('search-dialog');
    var closer = document.getElementById('search-close');
    var input = document.getElementById('search-input');
    var panel = document.getElementById('search-results');
    // Marcação incompleta: melhor nenhuma lupa do que uma lupa morta.
    if (!toggle || !overlay || !dialog || !closer || !input || !panel) {
      document.documentElement.classList.remove('js-search');
      return;
    }

    var reduced = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var records = null;      // índice normalizado, carregado sob demanda
    var loading = null;      // promise em voo, para não baixar duas vezes
    var results = [];        // resultados da consulta atual
    var active = -1;         // item destacado pelo teclado
    var timer = null;
    var exitTimer = null;    // esconde o overlay depois do fade
    var lastFocus = null;    // para quem devolver o foco ao fechar
    var downOnScrim = false; // ver o par mousedown/click do escurecido

    function load() {
      if (records) return Promise.resolve(records);
      if (loading) return loading;

      var url = input.dataset.index;
      if (!url) return Promise.resolve([]);

      loading = fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          records = data.map(function (d) {
            var tags = (d.g || []).join(' ');
            return {
              raw: d,
              t: normalize(d.t || ''),
              s: normalize(d.s || ''),
              // campeonato e tags compartilham o mesmo peso
              k: normalize((d.c || '') + ' ' + tags)
            };
          });
          return records;
        })
        .catch(function () {
          loading = null;
          records = [];
          return records;
        });

      return loading;
    }

    function score(rec, tokens) {
      var total = 0;
      for (var i = 0; i < tokens.length; i++) {
        var tk = tokens[i];
        var hit = 0;
        if (rec.t.indexOf(tk) !== -1) hit = 3;
        else if (rec.k.indexOf(tk) !== -1) hit = 2;
        else if (rec.s.indexOf(tk) !== -1) hit = 1;
        // semântica AND: todo token precisa aparecer em algum campo
        if (hit === 0) return 0;
        total += hit;
      }
      return total;
    }

    function search(query) {
      var tokens = normalize(query).split(/\s+/).filter(Boolean);
      if (!tokens.length || !records) return [];

      var scored = [];
      for (var i = 0; i < records.length; i++) {
        var s = score(records[i], tokens);
        if (s > 0) scored.push({ rec: records[i], score: s });
      }

      scored.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        // desempate: evento mais recente primeiro
        return (b.rec.raw.e || '').localeCompare(a.rec.raw.e || '');
      });

      return scored.map(function (x) { return x.rec.raw; });
    }

    /* Só limpa a listbox; quem fecha o modal é closeOverlay(). */
    function clearResults() {
      panel.hidden = true;
      panel.textContent = '';
      input.setAttribute('aria-expanded', 'false');
      results = [];
      active = -1;
    }

    function note(text) {
      var p = document.createElement('p');
      p.className = 'search-note';
      p.textContent = text;
      return p;
    }

    /* Reaproveita as classes de lista do tema (.post-line, .line-date,
       .line-title, .line-summary), então não há CSS novo para as linhas. */
    function row(item, i) {
      var line = document.createElement('div');
      line.className = 'post-line';
      line.setAttribute('role', 'option');
      line.setAttribute('aria-selected', 'false');
      line.dataset.i = String(i);

      var date = document.createElement('p');
      date.className = 'line-date';
      // já vem formatada pelo Hugo em layouts/index.json
      date.textContent = item.d || '';
      line.appendChild(date);

      var box = document.createElement('div');

      var title = document.createElement('p');
      title.className = 'line-title';
      var link = document.createElement('a');
      link.href = item.u;
      link.textContent = item.t;
      title.appendChild(link);
      box.appendChild(title);

      if (item.s) {
        var summary = document.createElement('p');
        summary.className = 'line-summary';
        summary.textContent = item.s;
        box.appendChild(summary);
      }

      line.appendChild(box);
      return line;
    }

    function render(query) {
      panel.textContent = '';
      active = -1;

      if (!query) {
        clearResults();
        return;
      }

      if (!results.length) {
        panel.appendChild(note('Nenhum resultado para "' + query + '".'));
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        return;
      }

      var shown = results.slice(0, MAX_RESULTS);
      for (var i = 0; i < shown.length; i++) {
        panel.appendChild(row(shown[i], i));
      }

      if (results.length > shown.length) {
        panel.appendChild(
          note(results.length + ' resultados — refine a busca para ver os demais.')
        );
      }

      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function highlight(next) {
      var rows = panel.querySelectorAll('.post-line');
      if (!rows.length) return;

      if (active >= 0 && rows[active]) {
        rows[active].classList.remove('is-active');
        rows[active].setAttribute('aria-selected', 'false');
      }

      active = next;
      if (active < 0) active = rows.length - 1;
      if (active >= rows.length) active = 0;

      rows[active].classList.add('is-active');
      rows[active].setAttribute('aria-selected', 'true');
      rows[active].scrollIntoView({ block: 'nearest' });
    }

    function run() {
      var query = input.value.trim();
      if (!query) {
        clearResults();
        return;
      }
      load().then(function () {
        // a consulta pode ter mudado enquanto o índice baixava
        var current = input.value.trim();
        if (current !== query) return;
        results = search(current);
        render(current);
      });
    }

    function openOverlay() {
      if (!overlay.hidden) return;

      clearTimeout(exitTimer);
      lastFocus = document.activeElement;

      overlay.hidden = false;
      document.documentElement.classList.add('search-open');
      toggle.setAttribute('aria-expanded', 'true');

      /* Dois requestAnimationFrame: com um só, o navegador às vezes junta o
         `hidden = false` e o `.is-open` no mesmo quadro de estilo e a transição
         não roda — o modal aparece estalado. O primeiro quadro pinta o estado
         inicial (opacidade 0), o segundo dispara a transição. */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          overlay.classList.add('is-open');
        });
      });

      /* Foco síncrono, dentro do gesto do clique: no iOS um focus() adiado para
         dentro do rAF não abre o teclado virtual. preventScroll porque a página
         está travada atrás do overlay. */
      try {
        input.focus({ preventScroll: true });
      } catch (e) {
        input.focus();
      }

      load();
    }

    function closeOverlay() {
      if (overlay.hidden) return;

      overlay.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.documentElement.classList.remove('search-open');

      clearTimeout(timer);
      input.value = '';
      clearResults();

      clearTimeout(exitTimer);
      exitTimer = setTimeout(function () {
        overlay.hidden = true;
      }, reduced ? 0 : EXIT_MS);

      /* Devolve o foco a quem abriu. Aberto pelo atalho de teclado, o
         activeElement era o <body>, que não recebe foco — nesse caso o destino
         certo é a lupa, senão o próximo Tab recomeça do topo da página. */
      var back = (lastFocus && lastFocus.focus && lastFocus !== document.body)
        ? lastFocus
        : toggle;
      back.focus();
      lastFocus = null;
    }

    /* Só há dois controles fixos (campo e fechar), mas os títulos dos resultados
       são links e entram na ordem de tabulação — por isso a lista é recalculada
       a cada Tab em vez de memorizada. offsetParent nulo descarta o que está
       dentro do painel escondido. */
    function focusable() {
      var all = dialog.querySelectorAll('input, button, a[href]');
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].offsetParent !== null) out.push(all[i]);
      }
      return out;
    }

    function trap(e) {
      var f = focusable();
      if (!f.length) return;

      var first = f[0];
      var last = f[f.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    toggle.addEventListener('click', openOverlay);
    closer.addEventListener('click', closeOverlay);

    /* Aquece o índice antes do clique: passar o mouse ou tabular até o botão já
       é intenção suficiente, e load() é idempotente. */
    toggle.addEventListener('pointerenter', load);
    toggle.addEventListener('focus', load);

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    });

    /* O keydown fica no overlay, não no campo: assim o Esc fecha mesmo com o
       foco no botão de fechar ou num link de resultado. */
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();   // senão o Chrome só limpa o type=search
        closeOverlay();
        return;
      }

      if (e.key === 'Tab') {
        trap(e);
        return;
      }

      // as setas e o Enter só valem no campo; num link de resultado o Enter tem
      // de seguir o link normalmente
      if (e.target !== input || panel.hidden) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight(active - 1);
      } else if (e.key === 'Enter') {
        var rows = panel.querySelectorAll('.post-line');
        if (active >= 0 && rows[active]) {
          e.preventDefault();
          var link = rows[active].querySelector('a');
          if (link) window.location.href = link.href;
        }
      }
    });

    /* Clique no escurecido fecha. O par mousedown/click existe porque
       selecionar texto dentro do diálogo e soltar o botão fora dispara um click
       cujo alvo é o ancestral comum — o overlay — e fecharia sozinho. */
    overlay.addEventListener('mousedown', function (e) {
      downOnScrim = (e.target === overlay);
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && downOnScrim) closeOverlay();
      downOnScrim = false;
    });

    /* Atalhos globais: "/" e Ctrl/Cmd+K abrem a busca. Ignora quando o leitor já
       está digitando em algum campo. */
    document.addEventListener('keydown', function (e) {
      if (!overlay.hidden) return;

      var el = document.activeElement;
      var tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
          (el && el.isContentEditable)) return;

      var slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      var ctrlK = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey);

      if (slash || ctrlK) {
        e.preventDefault();
        openOverlay();
      }
    });
  });
})();
