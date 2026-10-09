import {
  BYE, FORMATS, CRITERIA, DEFAULT_TIEBREAKERS, MAX_GOALS,
  createTournament, maxGroups, distributeGroups, roundsWithScores, leagueStandings, groupStandings,
  groupMatches, groupStageComplete, generateKnockout, reopenGroups, setScore, setKnockoutResult,
  bracketState, knockoutPlacement, standingsCSV, validateTournament, backupJSON, teamNames, isPlayed,
} from './tournament.js';

const STORAGE_KEY = 'organizador-de-campeonato:atual';
const SAMPLE_TEAMS = [
  'Unidos da Vila', 'Estrela do Norte', 'Atlético Ipê', 'Real Jacarandá',
  'Leões da Serra', 'Esporte Clube Bem-te-vi', 'Juventude do Bairro', 'Grêmio Recreativo Sabiá',
];
const TABS = {
  league: [['games', 'Jogos'], ['table', 'Classificação']],
  knockout: [['bracket', 'Chave'], ['table', 'Situação']],
  groups: [['games', 'Grupos'], ['table', 'Classificação'], ['bracket', 'Mata-mata']],
};

const $ = (sel) => document.querySelector(sel);
const els = {
  message: $('#message'),
  setup: $('#setup'),
  form: $('#setup-form'),
  name: $('#name'),
  teams: $('#teams'),
  teamCount: $('#team-count'),
  sample: $('#sample'),
  double: $('#double'),
  groupCount: $('#group-count'),
  advance: $('#advance'),
  seeding: $('#seeding'),
  thirdPlace: $('#third-place'),
  ptsWin: $('#pts-win'),
  ptsDraw: $('#pts-draw'),
  ptsLoss: $('#pts-loss'),
  criteria: $('#criteria'),
  setupError: $('#setup-error'),
  setupCancel: $('#setup-cancel'),
  setupImport: $('#setup-import'),
  view: $('#tournament'),
  tName: $('#t-name'),
  tSummary: $('#t-summary'),
  tabs: $('#tabs'),
  panels: $('#panels'),
  exportJson: $('#export-json'),
  importJson: $('#import-json'),
  exportCsv: $('#export-csv'),
  print: $('#print'),
  newButton: $('#new'),
  file: $('#file'),
  dialog: $('#confirm'),
  dialogText: $('#confirm-text'),
  dialogYes: $('#confirm-yes'),
  dialogNo: $('#confirm-no'),
};

let tournament = load();
let activeTab = null;
let criteriaState = DEFAULT_TIEBREAKERS.map((id) => ({ id, enabled: true }));
const drafts = new Map();
let messageTimer = 0;

/* ---------------- utilidades ---------------- */

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function showMessage(text, kind = 'info') {
  clearTimeout(messageTimer);
  els.message.textContent = text;
  els.message.className = `message ${kind}`;
  els.message.hidden = false;
  messageTimer = setTimeout(() => { els.message.hidden = true; }, 6000);
}

function slug(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campeonato';
}

function download(filename, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function confirmAction(text, yesLabel = 'Confirmar') {
  const dialog = els.dialog;
  if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(text));
  els.dialogText.textContent = text;
  els.dialogYes.textContent = yesLabel;
  return new Promise((resolve) => {
    const finish = (value) => {
      els.dialogYes.removeEventListener('click', onYes);
      els.dialogNo.removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onNo);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    els.dialogYes.addEventListener('click', onYes);
    els.dialogNo.addEventListener('click', onNo);
    dialog.addEventListener('cancel', onNo);
    dialog.showModal();
    els.dialogNo.focus();
  });
}

/* ---------------- armazenamento ---------------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateTournament(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    if (tournament) localStorage.setItem(STORAGE_KEY, backupJSON(tournament));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    showMessage('Não deu para salvar no navegador (armazenamento cheio ou bloqueado). Use "Exportar backup".', 'error');
  }
}

/* ---------------- formulário de criação ---------------- */

function teamLines() {
  return els.teams.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function selectedFormat() {
  return els.form.querySelector('input[name="format"]:checked').value;
}

function fillSelect(select, values, labelFor, keep) {
  const previous = keep ?? select.value;
  select.replaceChildren(...values.map((v) => new Option(labelFor(v), String(v))));
  if (values.map(String).includes(previous)) select.value = previous;
}

function updateSetup() {
  const n = teamLines().length;
  els.teamCount.textContent = `${n} ${n === 1 ? 'time' : 'times'}`;
  const format = selectedFormat();
  els.form.querySelectorAll('[data-for]').forEach((el) => {
    el.hidden = !el.dataset.for.split(' ').includes(format);
  });
  els.seeding.options[0].textContent = format === 'league' ? 'Tabela pela ordem da lista' : 'Pela ordem da lista (cabeças de chave)';
  els.seeding.options[1].textContent = format === 'league' ? 'Tabela sorteada' : format === 'groups' ? 'Grupos sorteados' : 'Chave sorteada';
  const max = maxGroups(n);
  const groupOptions = [];
  for (let g = 2; g <= max; g++) groupOptions.push(g);
  fillSelect(els.groupCount, groupOptions, (g) => `${g} grupos`, els.groupCount.value || '2');
  const g = Number(els.groupCount.value) || 2;
  const smallest = groupOptions.length ? Math.min(...distributeGroups([...Array(n).keys()], g).map((x) => x.length)) : 0;
  const advanceOptions = [];
  for (let a = 1; a < smallest; a++) advanceOptions.push(a);
  fillSelect(els.advance, advanceOptions, (a) => (a === 1 ? '1 (só o líder)' : `${a} primeiros`), els.advance.value || '2');
}

function renderCriteria() {
  const items = [h('li', { class: 'criterion fixed' }, h('span', { text: 'Pontos' }), h('span', { class: 'muted', text: 'sempre primeiro' }))];
  criteriaState.forEach((c, i) => {
    const id = `crit-${c.id}`;
    items.push(h('li', { class: 'criterion' },
      h('label', { for: id, class: 'criterion-label' },
        h('input', { type: 'checkbox', id, checked: c.enabled, onchange: (e) => { c.enabled = e.target.checked; } }),
        ` ${CRITERIA[c.id]}`),
      h('span', { class: 'criterion-move' },
        h('button', { type: 'button', class: 'btn secondary tiny', 'aria-label': `Subir ${CRITERIA[c.id]}`, disabled: i === 0, onclick: () => moveCriterion(i, -1) }, 'Subir'),
        h('button', { type: 'button', class: 'btn secondary tiny', 'aria-label': `Descer ${CRITERIA[c.id]}`, disabled: i === criteriaState.length - 1, onclick: () => moveCriterion(i, 1) }, 'Descer')),
    ));
  });
  items.push(h('li', { class: 'criterion fixed' }, h('span', { text: 'Sorteio' }), h('span', { class: 'muted', text: 'sempre por último' })));
  els.criteria.replaceChildren(...items);
}

function moveCriterion(index, delta) {
  const target = index + delta;
  [criteriaState[index], criteriaState[target]] = [criteriaState[target], criteriaState[index]];
  renderCriteria();
  els.criteria.querySelector(`button[aria-label="${delta < 0 ? 'Subir' : 'Descer'} ${CRITERIA[criteriaState[target].id]}"]`)?.focus();
}

els.teams.addEventListener('input', updateSetup);
els.groupCount.addEventListener('change', updateSetup);
els.form.querySelectorAll('input[name="format"]').forEach((r) => r.addEventListener('change', updateSetup));
els.sample.addEventListener('click', () => {
  els.teams.value = SAMPLE_TEAMS.join('\n');
  if (!els.name.value.trim()) els.name.value = 'Copa do Bairro';
  updateSetup();
});

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  els.setupError.textContent = '';
  try {
    const t = createTournament({
      name: els.name.value,
      format: selectedFormat(),
      teams: els.teams.value,
      double: els.double.value === 'yes',
      thirdPlace: els.thirdPlace.checked,
      seeding: els.seeding.value,
      groupCount: Number(els.groupCount.value),
      advance: Number(els.advance.value),
      points: { win: Number(els.ptsWin.value), draw: Number(els.ptsDraw.value), loss: Number(els.ptsLoss.value) },
      tiebreakers: criteriaState.filter((c) => c.enabled).map((c) => c.id),
    });
    tournament = t;
    drafts.clear();
    activeTab = null;
    save();
    showTournament();
    showMessage(`Campeonato criado: ${FORMATS[t.format].toLowerCase()} com ${t.teams.length} times.`, 'ok');
  } catch (err) {
    els.setupError.textContent = err.message;
  }
});

els.setupCancel.addEventListener('click', () => {
  if (tournament) showTournament();
});

function showSetup() {
  els.view.hidden = true;
  els.setup.hidden = false;
  els.setupCancel.hidden = !tournament;
  renderCriteria();
  updateSetup();
  els.name.focus();
}

/* ---------------- visão do campeonato ---------------- */

function showTournament() {
  els.setup.hidden = true;
  els.view.hidden = false;
  renderTournament();
}

function names() {
  return teamNames(tournament);
}

function summaryText() {
  const t = tournament;
  const n = t.teams.length;
  if (t.format === 'league') {
    const all = t.league.rounds.flatMap((r) => r.matches);
    const done = all.filter((m) => t.results[m.id]).length;
    const leader = done ? leagueStandings(t).rows[0] : null;
    return `Pontos corridos · ${n} times · ${t.league.rounds.length} rodadas · ${done} de ${all.length} jogos com placar`
      + (leader ? ` · líder: ${names()[leader.id]}` : '');
  }
  const state = bracketState(t);
  const champion = state && state.champion && state.runnerUp ? ` · campeão: ${names()[state.champion]}` : '';
  if (t.format === 'knockout') return `Mata-mata · ${n} times${champion}`;
  const all = t.groups.list.flatMap((g) => groupMatches(t, g));
  const done = all.filter(isPlayed).length;
  return `Grupos + mata-mata · ${n} times em ${t.groups.list.length} grupos · ${t.groups.advance} por grupo avançam · grupos: ${done} de ${all.length} jogos${champion}`;
}

function renderSummary() {
  els.tName.textContent = tournament.name;
  els.tSummary.textContent = summaryText();
}

function renderTournament() {
  renderSummary();
  const tabs = TABS[tournament.format];
  if (!tabs.some(([id]) => id === activeTab)) activeTab = tabs[0][0];
  els.tabs.replaceChildren(...tabs.map(([id, label]) => h('button', {
    type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`,
    'aria-selected': String(id === activeTab), tabindex: id === activeTab ? '0' : '-1', class: 'tab',
    onclick: () => selectTab(id),
  }, label)));
  els.panels.replaceChildren(...tabs.map(([id]) => h('div', {
    role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, class: 'panel', hidden: id !== activeTab,
  })));
  renderPanel('games');
  renderPanel('table');
  renderPanel('bracket');
}

function selectTab(id, focus = false) {
  activeTab = id;
  els.tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
    const selected = tab.id === `tab-${id}`;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  els.panels.querySelectorAll('[role="tabpanel"]').forEach((panel) => { panel.hidden = panel.id !== `panel-${id}`; });
}

els.tabs.addEventListener('keydown', (event) => {
  const ids = TABS[tournament.format].map(([id]) => id);
  const i = ids.indexOf(activeTab);
  let next = null;
  if (event.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
  else if (event.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
  else if (event.key === 'Home') next = ids[0];
  else if (event.key === 'End') next = ids[ids.length - 1];
  if (next) {
    event.preventDefault();
    selectTab(next, true);
  }
});

function renderPanel(id) {
  const panel = document.getElementById(`panel-${id}`);
  if (!panel) return;
  const focusedId = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.id : null;
  if (id === 'games') panel.replaceChildren(...gamesPanel());
  if (id === 'table') panel.replaceChildren(...tablePanel());
  if (id === 'bracket') panel.replaceChildren(...bracketPanel());
  if (focusedId) document.getElementById(focusedId)?.focus();
}

/* ---------------- jogos (pontos corridos e grupos) ---------------- */

function scoreInput(matchId, side, value, teamName, disabled) {
  return h('input', {
    type: 'number', inputmode: 'numeric', min: '0', max: String(MAX_GOALS), step: '1',
    id: `score-${matchId}-${side}`, class: 'score', value: value ?? '', disabled,
    'aria-label': `Gols de ${teamName}`,
  });
}

function roundsSection(rounds, { locked, prefix }) {
  const nm = names();
  const scored = roundsWithScores(tournament, rounds);
  const firstOpen = scored.findIndex((r) => r.matches.some((m) => !isPlayed(m)));
  return scored.map((round, i) => {
    const done = round.matches.filter(isPlayed).length;
    const count = h('span', { class: 'round-count', text: `${done} de ${round.matches.length} com placar` });
    const list = h('ul', { class: 'matches' }, round.matches.map((m) => {
      const draft = drafts.get(m.id);
      return h('li', { class: 'match', 'data-match': m.id },
        h('span', { class: 'team home', text: nm[m.home] }),
        scoreInput(m.id, 'home', draft ? draft.home : m.homeGoals, nm[m.home], locked),
        h('span', { class: 'versus', 'aria-hidden': 'true', text: 'x' }),
        scoreInput(m.id, 'away', draft ? draft.away : m.awayGoals, nm[m.away], locked),
        h('span', { class: 'team away', text: nm[m.away] }),
      );
    }));
    const details = h('details', { class: 'round', open: i === firstOpen || (firstOpen === -1 && i === scored.length - 1) },
      h('summary', {}, h('span', { class: 'round-title', text: `${prefix}Rodada ${round.number}` }), count),
      list,
      round.bye ? h('p', { class: 'bye', text: `Folga: ${nm[round.bye]}` }) : null,
    );
    return details;
  });
}

function gamesPanel() {
  const t = tournament;
  if (t.format === 'league') {
    return [h('p', { class: 'hint', text: 'Digite o placar de cada jogo. A classificação é atualizada na hora; deixe os dois campos vazios para apagar um placar.' }),
      ...roundsSection(t.league.rounds, { locked: false, prefix: '' })];
  }
  if (t.format !== 'groups') return [];
  const locked = Boolean(t.knockout.bracket);
  const out = [];
  if (locked) {
    out.push(h('div', { class: 'notice' },
      h('p', { text: 'O mata-mata já foi gerado, então os placares dos grupos estão travados.' }),
      h('button', { type: 'button', class: 'btn secondary small', onclick: onReopenGroups }, 'Reabrir fase de grupos')));
  } else {
    out.push(h('p', { class: 'hint', text: 'Digite os placares dos grupos. Quando todos estiverem preenchidos, gere o mata-mata na aba Mata-mata.' }));
  }
  const nm = names();
  for (const g of t.groups.list) {
    out.push(h('section', { class: 'group-block', 'aria-label': `Grupo ${g.name}` },
      h('h3', { text: `Grupo ${g.name}` }),
      h('p', { class: 'muted small', text: g.teams.map((id) => nm[id]).join(', ') }),
      ...roundsSection(g.rounds, { locked, prefix: '' })));
  }
  return out;
}

async function onReopenGroups() {
  const ok = await confirmAction('Reabrir a fase de grupos apaga o chaveamento e todos os resultados do mata-mata. Continuar?', 'Reabrir');
  if (!ok) return;
  tournament = reopenGroups(tournament);
  save();
  renderTournament();
  showMessage('Fase de grupos reaberta. Corrija os placares e gere o mata-mata de novo.', 'ok');
}

els.panels.addEventListener('input', (event) => {
  const input = event.target;
  if (!input.classList.contains('score')) return;
  const row = input.closest('.match');
  if (!row) return;
  const id = row.dataset.match;
  const [home, away] = row.querySelectorAll('input.score');
  const values = [home.value.trim(), away.value.trim()];
  const valid = (v) => v === '' || (/^\d{1,2}$/.test(v) && Number(v) <= MAX_GOALS);
  home.setAttribute('aria-invalid', String(!valid(values[0])));
  away.setAttribute('aria-invalid', String(!valid(values[1])));
  if (!valid(values[0]) || !valid(values[1])) return;
  if ((values[0] === '') !== (values[1] === '')) {
    drafts.set(id, { home: values[0], away: values[1] });
    row.classList.add('partial');
    return;
  }
  drafts.delete(id);
  row.classList.remove('partial');
  try {
    tournament = setScore(tournament, id, values[0], values[1]);
  } catch (err) {
    showMessage(err.message, 'error');
    return;
  }
  save();
  renderSummary();
  renderPanel('table');
  if (tournament.format === 'groups') renderPanel('bracket');
  const details = row.closest('details');
  const counter = details && details.querySelector('.round-count');
  if (counter) {
    const inputs = [...details.querySelectorAll('.match')];
    const done = inputs.filter((li) => tournament.results[li.dataset.match]).length;
    counter.textContent = `${done} de ${inputs.length} com placar`;
  }
});

/* ---------------- classificação ---------------- */

function standingsTable(rows, { caption, qualified = 0 }) {
  const nm = names();
  const head = [['#', 'Posição'], ['Time', null], ['P', 'Pontos'], ['J', 'Jogos'], ['V', 'Vitórias'], ['E', 'Empates'],
    ['D', 'Derrotas'], ['GP', 'Gols pró'], ['GC', 'Gols contra'], ['SG', 'Saldo de gols'], ['%', 'Aproveitamento']];
  return h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
    h('caption', { text: caption }),
    h('thead', {}, h('tr', {}, head.map(([abbr, title]) => h('th', { scope: 'col', class: title ? null : 'team-head' }, title ? h('abbr', { title, text: abbr }) : abbr)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: r.position <= qualified ? 'qualified' : null },
      h('td', { text: String(r.position) }),
      h('th', { scope: 'row', class: 'team-cell', text: nm[r.id] }),
      h('td', { class: 'pts', text: String(r.points) }),
      h('td', { text: String(r.played) }),
      h('td', { text: String(r.wins) }),
      h('td', { text: String(r.draws) }),
      h('td', { text: String(r.losses) }),
      h('td', { text: String(r.goalsFor) }),
      h('td', { text: String(r.goalsAgainst) }),
      h('td', { text: r.goalDifference > 0 ? `+${r.goalDifference}` : String(r.goalDifference) }),
      h('td', { text: r.percentage.toFixed(1).replace('.', ',') }),
    ))),
  ));
}

function notesList(notes) {
  if (!notes.length) return null;
  const nm = names();
  return h('ul', { class: 'notes' }, notes.map((n) => h('li', {
    text: `${nm[n.ahead]} ficou à frente de ${nm[n.behind]} por ${CRITERIA[n.criterion].toLowerCase()}.`,
  })));
}

function criteriaLine() {
  const list = ['Pontos', ...tournament.tiebreakers.map((c) => CRITERIA[c]), 'Sorteio'];
  const p = tournament.points;
  return h('p', { class: 'hint', text: `Pontuação: vitória ${p.win}, empate ${p.draw}, derrota ${p.loss}. Critérios, nesta ordem: ${list.join(', ')}.` });
}

function tablePanel() {
  const t = tournament;
  if (t.format === 'league') {
    const { rows, notes } = leagueStandings(t);
    return [standingsTable(rows, { caption: 'Classificação' }), notesList(notes), criteriaLine()].filter(Boolean);
  }
  if (t.format === 'groups') {
    const out = [];
    for (const { group, rows, notes } of groupStandings(t)) {
      out.push(standingsTable(rows, { caption: `Grupo ${group.name}`, qualified: t.groups.advance }));
      const list = notesList(notes);
      if (list) out.push(list);
    }
    out.push(h('p', { class: 'legend' }, h('span', { class: 'swatch' }), ` Zona de classificação: os ${t.groups.advance} primeiros de cada grupo.`));
    out.push(criteriaLine());
    return out;
  }
  const nm = names();
  const placement = knockoutPlacement(t);
  return [h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
    h('caption', { text: 'Situação de cada time' }),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Time' }), h('th', { scope: 'col', text: 'Situação' }))),
    h('tbody', {}, placement.map((p) => h('tr', {}, h('th', { scope: 'row', class: 'team-cell', text: nm[p.id] }), h('td', { text: p.situation })))),
  ))];
}

/* ---------------- chave ---------------- */

function bracketPanel() {
  const t = tournament;
  if (t.format === 'league') return [];
  if (t.format === 'groups' && !t.knockout.bracket) {
    const all = t.groups.list.flatMap((g) => groupMatches(t, g));
    const done = all.filter(isPlayed).length;
    const complete = groupStageComplete(t);
    const total = t.groups.list.length * t.groups.advance;
    return [
      h('p', { text: `Classificam-se os ${t.groups.advance} primeiros de cada grupo: ${total} times.` }),
      h('p', { class: 'hint', text: 'Os cabeças de chave saem da campanha (aproveitamento, saldo e gols por jogo) e times do mesmo grupo não se enfrentam na primeira fase do mata-mata.' }),
      h('p', { class: complete ? 'ok-text' : 'muted', text: complete ? 'Fase de grupos completa.' : `Faltam placares: ${done} de ${all.length} jogos dos grupos preenchidos.` }),
      h('button', { type: 'button', class: 'btn', disabled: !complete, onclick: onGenerate }, 'Gerar mata-mata'),
    ];
  }
  const state = bracketState(t);
  const nm = names();
  const raw = new Map();
  for (const round of t.knockout.bracket.rounds) for (const m of round.matches) raw.set(m.id, m);
  if (t.knockout.bracket.thirdPlace) raw.set('K3', t.knockout.bracket.thirdPlace);
  const numbers = new Map();
  let k = 1;
  for (const round of state.rounds) for (const m of round.matches) if (m.status !== 'bye') numbers.set(m.id, k++);
  if (state.thirdPlace) numbers.set(state.thirdPlace.id, k++);
  const seeds = new Map((t.knockout.seeds || []).map((s) => [s.team, `${s.position}º ${s.group}`]));

  const sideLabel = (team, slot) => {
    if (team === BYE) return 'Folga';
    if (team) return nm[team];
    if (slot.winner) return numbers.has(slot.winner) ? `Vencedor do jogo ${numbers.get(slot.winner)}` : 'A definir';
    if (slot.loser) return `Perdedor do jogo ${numbers.get(slot.loser)}`;
    return 'A definir';
  };

  const card = (m) => {
    const rawMatch = raw.get(m.id);
    const editable = m.status === 'ready' || m.status === 'played';
    const r = m.result;
    const label = numbers.has(m.id) ? `Jogo ${numbers.get(m.id)}` : 'Folga';
    const side = (team, slot, key) => h('div', { class: `ko-side${m.status === 'played' && m.winner === team ? ' winner' : ''}` },
      seeds.has(team) ? h('span', { class: 'seed', text: seeds.get(team) }) : null,
      h('span', { class: `ko-name${team && team !== BYE ? '' : ' pending'}`, text: sideLabel(team, slot) }),
      editable ? h('input', {
        type: 'number', inputmode: 'numeric', min: '0', max: String(MAX_GOALS), step: '1', class: 'ko-goals', name: key,
        id: `ko-${m.id}-${key}`, value: r ? String(r[key]) : '', 'aria-label': `Gols de ${sideLabel(team, slot)}`,
      }) : null,
    );
    let status = '';
    if (m.status === 'bye') status = `${nm[m.winner]} avança direto (folga).`;
    else if (m.status === 'pending') status = 'Aguardando os adversários.';
    else if (m.status === 'ready') status = 'Pronto para jogar.';
    else if (m.status === 'played') {
      const pens = r.homeGoals === r.awayGoals ? ` nos pênaltis (${r.homePens} x ${r.awayPens})` : '';
      status = `${nm[m.winner]} venceu${pens}.`;
    }
    const tie = Boolean(r) && r.homeGoals === r.awayGoals;
    const pensInput = (key, team, slot) => h('input', {
      type: 'number', inputmode: 'numeric', min: '0', max: String(MAX_GOALS), step: '1', class: 'ko-pens', name: key,
      id: `ko-${m.id}-${key}`, value: r && tie ? String(r[key]) : '', 'aria-label': `Pênaltis de ${sideLabel(team, slot)}`,
    });
    const body = [
      h('header', { class: 'ko-head', text: label }),
      side(m.home, rawMatch.slots[0], 'homeGoals'),
      side(m.away, rawMatch.slots[1], 'awayGoals'),
    ];
    if (editable) {
      body.push(h('div', { class: 'ko-pens-row', hidden: !tie },
        h('span', { text: 'Pênaltis' }), pensInput('homePens', m.home, rawMatch.slots[0]),
        h('span', { 'aria-hidden': 'true', text: 'x' }), pensInput('awayPens', m.away, rawMatch.slots[1])));
      body.push(h('div', { class: 'ko-actions' },
        h('button', { type: 'submit', class: 'btn small', id: `ko-${m.id}-save` }, m.status === 'played' ? 'Corrigir' : 'Salvar')));
    }
    body.push(h('p', { class: 'ko-status', id: `ko-${m.id}-status`, text: status }));
    const ariaLabel = `${m.roundName}${numbers.has(m.id) ? `, jogo ${numbers.get(m.id)}` : ''}`;
    return editable
      ? h('form', { class: `ko-match status-${m.status}`, 'data-match': m.id, 'aria-label': ariaLabel, novalidate: true }, body)
      : h('article', { class: `ko-match status-${m.status}`, 'data-match': m.id, 'aria-label': ariaLabel }, body);
  };

  const out = [];
  if (state.champion && state.runnerUp) {
    out.push(h('div', { class: 'champion', role: 'status' },
      h('span', { class: 'trophy', 'aria-hidden': 'true', text: '🏆' }),
      h('div', {}, h('strong', { text: `Campeão: ${nm[state.champion]}` }),
        h('span', { text: ` Vice: ${nm[state.runnerUp]}${state.third ? `. Terceiro: ${nm[state.third]}` : ''}.` }))));
  }
  out.push(h('p', { class: 'hint', text: 'Digite o placar e clique em Salvar (ou tecle Enter). No empate, aparecem os campos de pênaltis.' }));
  out.push(h('div', { class: 'bracket' }, state.rounds.map((round) => h('section', { class: 'bracket-round', 'aria-label': round.name },
    h('h3', { text: round.name }),
    h('div', { class: 'bracket-matches' }, round.matches.map(card))))));
  if (state.thirdPlace) {
    out.push(h('section', { class: 'third-place', 'aria-label': 'Disputa de 3º lugar' }, h('h3', { text: 'Disputa de 3º lugar' }), card(state.thirdPlace)));
  }
  return out;
}

function onGenerate() {
  try {
    tournament = generateKnockout(tournament);
  } catch (err) {
    showMessage(err.message, 'error');
    return;
  }
  save();
  renderTournament();
  selectTab('bracket');
  showMessage('Mata-mata gerado a partir da classificação dos grupos.', 'ok');
}

els.panels.addEventListener('input', (event) => {
  const input = event.target;
  if (!input.classList.contains('ko-goals')) return;
  const form = input.closest('form.ko-match');
  const home = form.elements.homeGoals.value.trim();
  const away = form.elements.awayGoals.value.trim();
  form.querySelector('.ko-pens-row').hidden = !(home !== '' && home === away);
});

els.panels.addEventListener('submit', (event) => {
  const form = event.target.closest('form.ko-match');
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.match;
  const field = (name) => form.elements[name].value.trim();
  const values = { homeGoals: field('homeGoals'), awayGoals: field('awayGoals'), homePens: field('homePens'), awayPens: field('awayPens') };
  try {
    tournament = setKnockoutResult(tournament, id, values);
  } catch (err) {
    const status = document.getElementById(`ko-${id}-status`);
    status.textContent = err.message;
    status.classList.add('error');
    status.setAttribute('role', 'alert');
    return;
  }
  save();
  renderSummary();
  renderPanel('bracket');
  renderPanel('table');
  const next = els.panels.querySelector('#panel-bracket form.status-ready .ko-goals');
  (next || document.getElementById(`ko-${id}-save`))?.focus();
  if (!next && bracketState(tournament).champion) showMessage('Fim de campeonato! O campeão está no topo da chave.', 'ok');
});

/* ---------------- barra de ferramentas ---------------- */

els.exportJson.addEventListener('click', () => {
  download(`${slug(tournament.name)}.json`, 'application/json', backupJSON(tournament));
  showMessage('Backup exportado. Guarde o arquivo para continuar em outro navegador.', 'ok');
});

els.exportCsv.addEventListener('click', () => {
  download(`${slug(tournament.name)}-classificacao.csv`, 'text/csv;charset=utf-8', standingsCSV(tournament));
});

els.print.addEventListener('click', () => window.print());

/* Na impressão, todas as rodadas aparecem abertas; depois voltam como estavam. */
let closedForPrint = [];
window.addEventListener('beforeprint', () => {
  closedForPrint = [...document.querySelectorAll('details.round:not([open])')];
  closedForPrint.forEach((d) => { d.open = true; });
});
window.addEventListener('afterprint', () => {
  closedForPrint.forEach((d) => { d.open = false; });
  closedForPrint = [];
});

els.newButton.addEventListener('click', async () => {
  const ok = await confirmAction('Começar um campeonato novo? O atual sai deste navegador (exporte o backup antes, se quiser guardar).', 'Começar novo');
  if (!ok) return;
  els.name.value = '';
  els.teams.value = tournament.teams.map((x) => x.name).join('\n');
  showSetup();
});

function pickFile() {
  els.file.value = '';
  els.file.click();
}
els.importJson.addEventListener('click', pickFile);
els.setupImport.addEventListener('click', pickFile);

els.file.addEventListener('change', async () => {
  const file = els.file.files && els.file.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showMessage('Arquivo grande demais para um backup (limite de 5 MB).', 'error');
    return;
  }
  let data;
  try {
    data = validateTournament(JSON.parse(await file.text()));
  } catch (err) {
    showMessage(err instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : err.message, 'error');
    return;
  }
  if (tournament && !els.view.hidden) {
    const ok = await confirmAction(`Importar "${data.name}" e substituir o campeonato atual?`, 'Importar');
    if (!ok) return;
  }
  tournament = data;
  drafts.clear();
  activeTab = null;
  save();
  showTournament();
  showMessage(`Backup "${data.name}" importado.`, 'ok');
});

/* ---------------- início ---------------- */

if (tournament) showTournament();
else showSetup();
