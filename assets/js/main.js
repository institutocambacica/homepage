/*
 * Busca do cabeçalho.
 *
 * O tema injeta este arquivo em themes/typo/layouts/partials/head/js.html com
 * um <script> SEM `defer`, dentro do <head> — ou seja, ele roda antes do DOM
 * existir. Daí o DOMContentLoaded envolvendo tudo.
 *
 * O índice (/index.json) só é baixado quando o leitor interage com o campo:
 * a busca está em todas as páginas e nenhuma delas deve pagar por ela ao
 * carregar.
 */

(function () {
  'use strict';

  var MAX_RESULTS = 8;
  var DEBOUNCE_MS = 120;

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

  ready(function () {
    var input = document.getElementById('search-input');
    var panel = document.getElementById('search-results');
    var wrapper = document.getElementById('search');
    if (!input || !panel || !wrapper) return;

    // Há JS: o campo pode aparecer.
    input.hidden = false;

    var records = null;      // índice normalizado, carregado sob demanda
    var loading = null;      // promise em voo, para não baixar duas vezes
    var results = [];        // resultados da consulta atual
    var active = -1;         // item destacado pelo teclado
    var timer = null;

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

    function close() {
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
        close();
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
        close();
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

    input.addEventListener('focus', load);

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        close();
        input.blur();
        return;
      }
      if (panel.hidden) return;

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

    document.addEventListener('click', function (e) {
      if (!wrapper.contains(e.target)) close();
    });
  });
})();
