/**
 * Lógica do campeonato, sem DOM: tabela de pontos corridos (tabelas de
 * Berger), chaveamento do mata-mata com folgas e cabeças de chave, fase de
 * grupos, classificação com critérios de desempate configuráveis, CSV e
 * validação do backup em JSON.
 */

export const APP_ID = 'organizador-de-campeonato';
export const DATA_VERSION = 1;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 64;
export const MAX_NAME = 40;
export const MAX_GOALS = 99;
export const BYE = '#folga';

export const FORMATS = { league: 'Pontos corridos', knockout: 'Mata-mata', groups: 'Grupos + mata-mata' };

export const CRITERIA = {
  points: 'Pontos',
  wins: 'Vitórias',
  goalDifference: 'Saldo de gols',
  goalsFor: 'Gols pró',
  headToHead: 'Confronto direto',
  draw: 'Sorteio',
};
/** Critérios que o usuário pode ordenar. Pontos vêm sempre antes e o sorteio sempre por último. */
export const TIEBREAKERS = ['wins', 'goalDifference', 'goalsFor', 'headToHead'];
export const DEFAULT_TIEBREAKERS = [...TIEBREAKERS];
export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

const mod = (n, m) => ((n % m) + m) % m;

/* ------------------------------------------------------------------ */
/* Sorteio                                                             */
/* ------------------------------------------------------------------ */

/** Gerador com semente (mulberry32), usado nos testes. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorteio de verdade para o uso normal: crypto.getRandomValues. */
export function secureRandom() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

/** Embaralhamento de Fisher-Yates. */
export function shuffle(list, rng = secureRandom) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pontos corridos: tabelas de Berger                                  */
/* ------------------------------------------------------------------ */

/**
 * Turno completo pelo método do círculo na forma das tabelas de Berger.
 * Com n participantes (n par; se for ímpar entra uma "folga"), numerados de
 * 1 a n, na rodada r (de 1 a n - 1):
 *   - x e y (ambos diferentes de n) se enfrentam quando x + y = r + 1 (mod n - 1);
 *     manda o jogo quem tem (y - x) mod (n - 1) ímpar;
 *   - n enfrenta o único a com 2a = r + 1 (mod n - 1); n manda nas rodadas pares.
 * Cada par se enfrenta uma vez, ninguém joga duas vezes na mesma rodada, os
 * mandos ficam divididos (diferença de no máximo 1) e o número de quebras
 * (dois mandos ou duas visitas seguidas) é o mínimo possível, n - 2.
 * No returno, os jogos se repetem com os mandos trocados.
 */
export function roundRobin(ids, { double = false } = {}) {
  const players = [...ids];
  if (players.length < 2) return [];
  if (players.length % 2 === 1) players.push(null);
  const n = players.length;
  const m = n - 1;
  const norm = (x) => mod(x - 1, m) + 1;
  const half = (m + 1) / 2; // inverso de 2 módulo m (m é ímpar)
  const rounds = [];
  for (let r = 1; r <= m; r++) {
    const pairs = [];
    const a = norm((r + 1) * half);
    pairs.push(r % 2 === 1 ? [a, n] : [n, a]);
    for (let x = 1; x <= m; x++) {
      if (x === a) continue;
      const y = norm(r + 1 - x);
      if (x < y) pairs.push(mod(y - x, m) % 2 === 1 ? [x, y] : [y, x]);
    }
    const matches = [];
    let bye = null;
    for (const [h, v] of pairs) {
      const home = players[h - 1];
      const away = players[v - 1];
      if (home === null) bye = away;
      else if (away === null) bye = home;
      else matches.push({ home, away });
    }
    rounds.push({ matches, bye });
  }
  if (double) {
    for (let r = 0; r < m; r++) {
      rounds.push({ matches: rounds[r].matches.map(({ home, away }) => ({ home: away, away: home })), bye: rounds[r].bye });
    }
  }
  return rounds;
}

/* ------------------------------------------------------------------ */
/* Grupos                                                              */
/* ------------------------------------------------------------------ */

export function groupName(index) {
  return String.fromCharCode(65 + index);
}

/**
 * Distribui em "serpentina" pela ordem da lista (que funciona como potes):
 * 1º no A, 2º no B, ..., e na volta do último grupo para o primeiro. Assim os
 * cabeças de chave ficam separados e os grupos têm tamanhos que diferem em 1.
 */
export function distributeGroups(ids, count) {
  const groups = Array.from({ length: count }, () => []);
  ids.forEach((id, i) => {
    const row = Math.floor(i / count);
    const col = i % count;
    groups[row % 2 === 0 ? col : count - 1 - col].push(id);
  });
  return groups;
}

/* ------------------------------------------------------------------ */
/* Mata-mata                                                           */
/* ------------------------------------------------------------------ */

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Ordem dos cabeças de chave no chaveamento: 1 e 2 só podem se cruzar na
 * final, 1 a 4 só nas semifinais, e assim por diante. Começa em [1, 2] e, a
 * cada dobra, cada semente s ganha como vizinha a semente (2k + 1) - s.
 * Para 8: 1 8 4 5 2 7 3 6.
 */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((s) => [s, sum - s]);
  }
  return order;
}

/**
 * Posições da primeira fase: os participantes vão pela ordem de cabeça de
 * chave e as vagas que sobram até a próxima potência de 2 viram folgas
 * (null), que caem sempre contra os melhores cabeças de chave.
 */
export function seedSlots(entrants) {
  const size = Math.max(2, nextPowerOfTwo(entrants.length));
  return seedOrder(size).map((seed) => (seed <= entrants.length ? entrants[seed - 1] : null));
}

export function roundName(matchCount) {
  const names = { 1: 'Final', 2: 'Semifinal', 4: 'Quartas de final', 8: 'Oitavas de final' };
  return names[matchCount] || `Fase de ${matchCount * 2}`;
}

/** Monta o chaveamento a partir das posições da primeira fase (ids ou null para folga). */
export function buildBracket(slots, { thirdPlace = false } = {}) {
  const size = slots.length;
  if (size < 2 || nextPowerOfTwo(size) !== size) throw new Error('O chaveamento precisa de uma potência de 2 de posições.');
  const rounds = [];
  let previous = null;
  for (let count = size / 2, r = 1; count >= 1; count /= 2, r++) {
    const matches = [];
    for (let i = 0; i < count; i++) {
      const matchSlots = previous
        ? [{ winner: previous[2 * i].id }, { winner: previous[2 * i + 1].id }]
        : [slots[2 * i], slots[2 * i + 1]].map((x) => (x === null ? { bye: true } : { team: x }));
      matches.push({ id: `K${r}-${i + 1}`, slots: matchSlots });
    }
    rounds.push({ name: roundName(count), matches });
    previous = matches;
  }
  let third = null;
  if (thirdPlace && size >= 4) {
    const semis = rounds[rounds.length - 2].matches;
    const semiHasBye = semis.some((m) => m.slots.some((s) => s.bye));
    if (!semiHasBye) third = { id: 'K3', slots: [{ loser: semis[0].id }, { loser: semis[1].id }] };
  }
  return { size, rounds, thirdPlace: third };
}

function isGoal(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_GOALS;
}

/** Resultado de mata-mata válido: gols inteiros e, se empatar, pênaltis com vencedor. */
export function isValidKnockoutResult(r) {
  if (!r || !isGoal(r.homeGoals) || !isGoal(r.awayGoals)) return false;
  if (r.homeGoals !== r.awayGoals) return true;
  return isGoal(r.homePens) && isGoal(r.awayPens) && r.homePens !== r.awayPens;
}

/**
 * Resolve o chaveamento com os resultados: quem está em cada jogo, quem
 * avança, quem caiu. Um resultado só vale se foi lançado para os mesmos dois
 * times (se um resultado anterior mudar, o jogo seguinte volta a ficar aberto).
 * Status: 'bye' (folga, avança direto), 'pending' (esperando adversário),
 * 'ready' (pronto para jogar) e 'played'.
 */
export function resolveBracket(bracket, results = {}) {
  const info = new Map();
  const slotTeam = (slot) => {
    if (slot.bye) return BYE;
    if (slot.team) return slot.team;
    if (slot.winner) return info.get(slot.winner)?.winner ?? null;
    if (slot.loser) return info.get(slot.loser)?.loser ?? null;
    return null;
  };
  const resolve = (match, roundIndex, name) => {
    const [home, away] = match.slots.map(slotTeam);
    const entry = { id: match.id, roundIndex, roundName: name, home, away, status: 'pending', winner: null, loser: null, result: null };
    if (home === BYE || away === BYE) {
      const team = home === BYE ? away : home;
      if (team && team !== BYE) {
        entry.status = 'bye';
        entry.winner = team;
      }
    } else if (home && away) {
      const r = results[match.id];
      if (r && r.home === home && r.away === away && isValidKnockoutResult(r)) {
        const homeWins = r.homeGoals > r.awayGoals || (r.homeGoals === r.awayGoals && r.homePens > r.awayPens);
        entry.status = 'played';
        entry.result = r;
        entry.winner = homeWins ? home : away;
        entry.loser = homeWins ? away : home;
      } else {
        entry.status = 'ready';
      }
    }
    info.set(match.id, entry);
    return entry;
  };
  const rounds = bracket.rounds.map((round, i) => ({ name: round.name, matches: round.matches.map((m) => resolve(m, i, round.name)) }));
  const thirdPlace = bracket.thirdPlace ? resolve(bracket.thirdPlace, rounds.length, 'Disputa de 3º lugar') : null;
  const final = rounds[rounds.length - 1].matches[0];
  return {
    rounds,
    thirdPlace,
    matches: info,
    champion: final.winner,
    runnerUp: final.status === 'played' ? final.loser : null,
    third: thirdPlace ? thirdPlace.winner : null,
  };
}

/** Remove resultados de mata-mata que não valem mais (os times do jogo mudaram). */
export function pruneKnockoutResults(bracket, results) {
  const out = { ...results };
  const ids = new Set([...bracket.rounds.flatMap((r) => r.matches.map((m) => m.id)), ...(bracket.thirdPlace ? [bracket.thirdPlace.id] : [])]);
  for (;;) {
    const resolved = resolveBracket(bracket, out);
    const stale = [...ids].filter((id) => {
      const r = out[id];
      if (!r) return false;
      const m = resolved.matches.get(id);
      return !(m && (m.status === 'played' || m.status === 'ready') && r.home === m.home && r.away === m.away);
    });
    if (!stale.length) return out;
    for (const id of stale) delete out[id];
  }
}

/**
 * Evita que dois times do mesmo grupo se enfrentem logo na primeira fase do
 * mata-mata: troca o adversário de pior campanha por outro de mesma posição
 * (2º com 2º, por exemplo) de um confronto onde a troca não cria outro choque.
 * slots: entradas { team, group, position } ou null (folga).
 */
export function fixGroupClashes(slots) {
  const out = [...slots];
  const clash = (a, b) => a != null && b != null && a.group === b.group;
  for (let pass = 0; pass < out.length; pass++) {
    let changed = false;
    for (let k = 0; k < out.length; k += 2) {
      if (!clash(out[k], out[k + 1])) continue;
      let done = false;
      for (const samePosition of [true, false]) {
        for (let j = 0; j < out.length && !done; j += 2) {
          if (j === k) continue;
          for (const t of [j + 1, j]) {
            const other = out[t];
            const partner = out[t === j ? j + 1 : j];
            if (other == null || (samePosition && other.position !== out[k + 1].position)) continue;
            if (!clash(out[k], other) && !clash(partner, out[k + 1])) {
              [out[k + 1], out[t]] = [out[t], out[k + 1]];
              done = true;
              break;
            }
          }
        }
        if (done) break;
      }
      changed = changed || done;
    }
    if (!changed) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Classificação                                                       */
/* ------------------------------------------------------------------ */

export function isPlayed(match) {
  return isGoal(match.homeGoals) && isGoal(match.awayGoals);
}

function compareValues(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
  return a - b;
}

const VALUE = {
  points: (id, group, ctx) => ctx.stats.get(id).points,
  wins: (id, group, ctx) => ctx.stats.get(id).wins,
  goalDifference: (id, group, ctx) => ctx.stats.get(id).goalsFor - ctx.stats.get(id).goalsAgainst,
  goalsFor: (id, group, ctx) => ctx.stats.get(id).goalsFor,
  /** Minitabela só com os jogos entre os empatados: pontos, saldo e gols pró nesses jogos. */
  headToHead: (id, group, ctx) => {
    const members = new Set(group);
    let pts = 0;
    let gf = 0;
    let ga = 0;
    for (const m of ctx.played) {
      if (!members.has(m.home) || !members.has(m.away)) continue;
      let mine;
      let theirs;
      if (m.home === id) [mine, theirs] = [m.homeGoals, m.awayGoals];
      else if (m.away === id) [mine, theirs] = [m.awayGoals, m.homeGoals];
      else continue;
      gf += mine;
      ga += theirs;
      pts += mine > theirs ? ctx.points.win : mine === theirs ? ctx.points.draw : ctx.points.loss;
    }
    return [pts, gf - ga, gf];
  },
  draw: (id, group, ctx) => ctx.drawValues[id] ?? 0,
};

/**
 * Ordena os empatados critério a critério. Quando um critério separa só uma
 * parte, cada subgrupo que continua empatado recomeça a lista: assim o
 * confronto direto é recalculado apenas entre os que seguem empatados.
 */
function rank(ids, criteria, ctx, notes) {
  if (ids.length <= 1) return [...ids];
  for (const criterion of criteria) {
    const values = new Map(ids.map((id) => [id, VALUE[criterion](id, ids, ctx)]));
    const sorted = [...ids].sort((a, b) => compareValues(values.get(b), values.get(a)));
    const buckets = [];
    for (const id of sorted) {
      const last = buckets[buckets.length - 1];
      if (last && compareValues(values.get(last[0]), values.get(id)) === 0) last.push(id);
      else buckets.push([id]);
    }
    if (buckets.length === 1) continue;
    const ranked = buckets.map((bucket) => rank(bucket, criteria, ctx, notes));
    for (let i = 1; i < ranked.length; i++) {
      if (criterion !== 'points') notes.push({ ahead: ranked[i - 1][ranked[i - 1].length - 1], behind: ranked[i][0], criterion });
    }
    return ranked.flat();
  }
  return [...ids].sort((a, b) => String(ctx.names[a] ?? a).localeCompare(String(ctx.names[b] ?? b), 'pt-BR'));
}

export function normalizeTiebreakers(list) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (TIEBREAKERS.includes(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Classificação de um grupo de times a partir dos jogos (só contam os que
 * têm placar). Critérios: pontos, depois os desempates na ordem dada e, por
 * último, o sorteio (um número aleatório por time, fixado na criação).
 */
export function computeStandings(teamIds, matches, { points = DEFAULT_POINTS, tiebreakers = DEFAULT_TIEBREAKERS, drawValues = {}, names = {} } = {}) {
  const stats = new Map(teamIds.map((id) => [id, { id, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }]));
  const played = matches.filter((m) => isPlayed(m) && stats.has(m.home) && stats.has(m.away));
  for (const m of played) {
    const home = stats.get(m.home);
    const away = stats.get(m.away);
    home.played++;
    away.played++;
    home.goalsFor += m.homeGoals;
    home.goalsAgainst += m.awayGoals;
    away.goalsFor += m.awayGoals;
    away.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) {
      home.wins++;
      away.losses++;
      home.points += points.win;
      away.points += points.loss;
    } else if (m.homeGoals < m.awayGoals) {
      away.wins++;
      home.losses++;
      away.points += points.win;
      home.points += points.loss;
    } else {
      home.draws++;
      away.draws++;
      home.points += points.draw;
      away.points += points.draw;
    }
  }
  const criteria = ['points', ...normalizeTiebreakers(tiebreakers), 'draw'];
  const notes = [];
  const order = rank(teamIds, criteria, { stats, played, points, drawValues, names }, notes);
  const position = new Map(order.map((id, i) => [id, i]));
  notes.sort((a, b) => position.get(a.ahead) - position.get(b.ahead));
  const rows = order.map((id, i) => {
    const s = stats.get(id);
    const max = s.played * points.win;
    return {
      position: i + 1,
      ...s,
      goalDifference: s.goalsFor - s.goalsAgainst,
      percentage: max > 0 ? (100 * s.points) / max : 0,
    };
  });
  return { rows, notes };
}

/* ------------------------------------------------------------------ */
/* Campeonato completo                                                 */
/* ------------------------------------------------------------------ */

/** Limpa a lista de nomes: tira espaços, linhas vazias e confere repetidos e limites. */
export function normalizeTeamNames(text) {
  const lines = (Array.isArray(text) ? text : String(text).split(/\r?\n/))
    .map((s) => String(s).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length < MIN_TEAMS) throw new Error(`Informe pelo menos ${MIN_TEAMS} times, um por linha.`);
  if (lines.length > MAX_TEAMS) throw new Error(`O limite é de ${MAX_TEAMS} times.`);
  const long = lines.find((s) => s.length > MAX_NAME);
  if (long) throw new Error(`Nome longo demais (máximo de ${MAX_NAME} caracteres): ${long.slice(0, MAX_NAME)}...`);
  const seen = new Map();
  for (const name of lines) {
    const key = name.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) throw new Error(`Time repetido: ${name}`);
    seen.set(key, true);
  }
  return lines;
}

function withIds(rounds, prefix) {
  return rounds.map((round, r) => ({
    number: r + 1,
    bye: round.bye,
    matches: round.matches.map((m, i) => ({ id: `${prefix}${r + 1}-${i + 1}`, home: m.home, away: m.away })),
  }));
}

/** Maior número de grupos possível (pelo menos 2 times por grupo, até 16 grupos). */
export function maxGroups(teamCount) {
  return Math.min(16, Math.floor(teamCount / 2));
}

export function validatePoints(points) {
  const p = points || {};
  for (const k of ['win', 'draw', 'loss']) {
    if (!Number.isInteger(p[k]) || p[k] < 0 || p[k] > 10) throw new Error('A pontuação precisa ser de números inteiros de 0 a 10.');
  }
  if (!(p.win > p.draw && p.draw >= p.loss)) throw new Error('A vitória precisa valer mais que o empate, e o empate pelo menos o mesmo que a derrota.');
  return { win: p.win, draw: p.draw, loss: p.loss };
}

export function createTournament(options, rng = secureRandom) {
  const {
    name = 'Meu campeonato', format = 'league', teams: teamText, double = false, thirdPlace = false,
    seeding = 'order', groupCount = 2, advance = 2, points = DEFAULT_POINTS, tiebreakers = DEFAULT_TIEBREAKERS,
  } = options;
  if (!FORMATS[format]) throw new Error('Formato desconhecido.');
  const names = normalizeTeamNames(teamText);
  const cleanName = String(name).replace(/\s+/g, ' ').trim().slice(0, 80) || 'Meu campeonato';
  const usedDraws = new Set();
  const teams = names.map((teamName, i) => {
    let draw;
    do draw = Math.floor(rng() * 1e9); while (usedDraws.has(draw));
    usedDraws.add(draw);
    return { id: `t${i + 1}`, name: teamName, draw };
  });
  const ids = teams.map((t) => t.id);
  const order = seeding === 'random' ? shuffle(ids, rng) : ids;
  const t = {
    app: APP_ID,
    version: DATA_VERSION,
    name: cleanName,
    format,
    createdAt: new Date().toISOString(),
    teams,
    points: validatePoints(points),
    tiebreakers: normalizeTiebreakers(tiebreakers),
    seeding: seeding === 'random' ? 'random' : 'order',
    results: {},
  };
  if (format === 'league') {
    t.league = { double: Boolean(double), rounds: withIds(roundRobin(order, { double }), 'L') };
  } else if (format === 'knockout') {
    t.knockout = { thirdPlace: Boolean(thirdPlace), bracket: buildBracket(seedSlots(order), { thirdPlace }) };
  } else {
    const count = Number(groupCount);
    if (!Number.isInteger(count) || count < 2 || count > maxGroups(ids.length)) {
      throw new Error(`Com ${ids.length} times dá para ter de 2 a ${maxGroups(ids.length)} grupos.`);
    }
    const lists = distributeGroups(order, count);
    const smallest = Math.min(...lists.map((g) => g.length));
    const adv = Number(advance);
    if (!Number.isInteger(adv) || adv < 1 || adv >= smallest) {
      throw new Error(`Com grupos de ${smallest} times, classifique de 1 a ${smallest - 1} por grupo.`);
    }
    t.groups = {
      double: Boolean(double),
      advance: adv,
      list: lists.map((teamIds, i) => ({ name: groupName(i), teams: teamIds, rounds: withIds(roundRobin(teamIds, { double }), `G${groupName(i)}`) })),
    };
    t.knockout = { thirdPlace: Boolean(thirdPlace), bracket: null, seeds: [] };
  }
  return t;
}

export function teamNames(t) {
  return Object.fromEntries(t.teams.map((team) => [team.id, team.name]));
}

function drawValues(t) {
  return Object.fromEntries(t.teams.map((team) => [team.id, team.draw]));
}

function withScore(t, match) {
  const r = t.results[match.id];
  return { ...match, homeGoals: r && isGoal(r.homeGoals) ? r.homeGoals : null, awayGoals: r && isGoal(r.awayGoals) ? r.awayGoals : null };
}

export function roundsWithScores(t, rounds) {
  return rounds.map((round) => ({ ...round, matches: round.matches.map((m) => withScore(t, m)) }));
}

export function leagueMatches(t) {
  return t.league.rounds.flatMap((r) => r.matches).map((m) => withScore(t, m));
}

export function groupMatches(t, group) {
  return group.rounds.flatMap((r) => r.matches).map((m) => withScore(t, m));
}

export function standingsFor(t, teamIds, matches) {
  return computeStandings(teamIds, matches, { points: t.points, tiebreakers: t.tiebreakers, drawValues: drawValues(t), names: teamNames(t) });
}

export function leagueStandings(t) {
  return standingsFor(t, t.teams.map((x) => x.id), leagueMatches(t));
}

export function groupStandings(t) {
  return t.groups.list.map((g) => ({ group: g, ...standingsFor(t, g.teams, groupMatches(t, g)) }));
}

export function groupStageComplete(t) {
  return t.format === 'groups' && t.groups.list.every((g) => groupMatches(t, g).every(isPlayed));
}

/**
 * Classificados da fase de grupos, já na ordem de cabeça de chave: primeiro
 * todos os 1ºs, depois os 2ºs... Entre os de mesma posição vale a melhor
 * campanha: aproveitamento, saldo por jogo, gols pró por jogo e sorteio
 * (por média, porque os grupos podem ter tamanhos diferentes).
 */
export function qualifiers(t) {
  const draws = drawValues(t);
  const entries = [];
  for (const { group, rows } of groupStandings(t)) {
    rows.slice(0, t.groups.advance).forEach((row) => entries.push({ team: row.id, group: group.name, position: row.position, row }));
  }
  const avg = (v, n) => (n > 0 ? v / n : 0);
  return entries.sort((a, b) => a.position - b.position
    || b.row.percentage - a.row.percentage
    || avg(b.row.goalDifference, b.row.played) - avg(a.row.goalDifference, a.row.played)
    || avg(b.row.goalsFor, b.row.played) - avg(a.row.goalsFor, a.row.played)
    || draws[b.team] - draws[a.team]);
}

/** Gera o mata-mata depois da fase de grupos. */
export function generateKnockout(t) {
  if (!groupStageComplete(t)) throw new Error('A fase de grupos ainda não terminou: faltam resultados.');
  const seeds = qualifiers(t);
  const slots = fixGroupClashes(seedSlots(seeds));
  const bracket = buildBracket(slots.map((e) => (e ? e.team : null)), { thirdPlace: t.knockout.thirdPlace });
  return { ...t, knockout: { ...t.knockout, bracket, seeds: seeds.map((e) => ({ team: e.team, group: e.group, position: e.position })) } };
}

/** Desfaz o mata-mata gerado a partir dos grupos (para corrigir um resultado de grupo). */
export function reopenGroups(t) {
  const results = { ...t.results };
  for (const id of Object.keys(results)) if (id.startsWith('K')) delete results[id];
  return { ...t, results, knockout: { ...t.knockout, bracket: null, seeds: [] } };
}

function parseGoal(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_GOALS) throw new Error(`Placar inválido: use números inteiros de 0 a ${MAX_GOALS}.`);
  return n;
}

/** Lança (ou apaga, com campos vazios) o placar de um jogo de pontos corridos ou de grupo. */
export function setScore(t, matchId, homeValue, awayValue) {
  const rounds = t.format === 'league' ? t.league.rounds : t.format === 'groups' ? t.groups.list.flatMap((g) => g.rounds) : [];
  if (!rounds.some((r) => r.matches.some((m) => m.id === matchId))) throw new Error('Jogo inexistente.');
  if (t.format === 'groups' && t.knockout.bracket) throw new Error('Reabra a fase de grupos para mudar este resultado.');
  const home = parseGoal(homeValue);
  const away = parseGoal(awayValue);
  const results = { ...t.results };
  if (home === null || away === null) delete results[matchId];
  else results[matchId] = { homeGoals: home, awayGoals: away };
  return { ...t, results };
}

/** Lança o resultado de um jogo do mata-mata (pênaltis obrigatórios no empate). */
export function setKnockoutResult(t, matchId, { homeGoals, awayGoals, homePens, awayPens }) {
  const bracket = t.knockout.bracket;
  const resolved = resolveBracket(bracket, t.results);
  const match = resolved.matches.get(matchId);
  if (!match) throw new Error('Jogo inexistente.');
  if (match.status !== 'ready' && match.status !== 'played') throw new Error('Este jogo ainda não tem os dois adversários.');
  const hg = parseGoal(homeGoals);
  const ag = parseGoal(awayGoals);
  let results = { ...t.results };
  if (hg === null || ag === null) {
    delete results[matchId];
  } else {
    const entry = { home: match.home, away: match.away, homeGoals: hg, awayGoals: ag };
    if (hg === ag) {
      const hp = parseGoal(homePens);
      const ap = parseGoal(awayPens);
      if (hp === null || ap === null || hp === ap) throw new Error('No mata-mata, empate se decide nos pênaltis: informe a disputa com um vencedor.');
      entry.homePens = hp;
      entry.awayPens = ap;
    }
    results[matchId] = entry;
  }
  results = pruneKnockoutResults(bracket, results);
  return { ...t, results };
}

export function bracketState(t) {
  return t.knockout && t.knockout.bracket ? resolveBracket(t.knockout.bracket, t.results) : null;
}

/** Situação final de cada time no mata-mata (para o CSV e o resumo). */
export function knockoutPlacement(t) {
  const state = bracketState(t);
  if (!state) return [];
  const place = new Map();
  for (const round of state.rounds) {
    for (const m of round.matches) {
      if (m.status === 'played') place.set(m.loser, `Eliminado: ${round.name.toLowerCase()}`);
    }
  }
  if (state.thirdPlace && state.thirdPlace.status === 'played') {
    place.set(state.thirdPlace.winner, '3º lugar');
    place.set(state.thirdPlace.loser, '4º lugar');
  }
  if (state.champion && state.runnerUp) {
    place.set(state.champion, 'Campeão');
    place.set(state.runnerUp, 'Vice-campeão');
  }
  const ids = new Set();
  for (const round of state.rounds) for (const m of round.matches) for (const x of [m.home, m.away]) if (x && x !== BYE) ids.add(x);
  return [...ids].map((id) => ({ id, situation: place.get(id) || 'Em disputa' }));
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Célula de CSV com proteção contra fórmulas (nomes que começam com = + - @). */
function csvText(value) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function decimal(value) {
  return value.toFixed(1).replace('.', ',');
}

/**
 * CSV no formato que o Excel em português abre direto: separador ponto e
 * vírgula, vírgula decimal, quebra CRLF e BOM UTF-8 no início.
 */
export function standingsCSV(t) {
  const names = teamNames(t);
  const header = ['Posição', 'Time', 'Pontos', 'Jogos', 'Vitórias', 'Empates', 'Derrotas', 'Gols pró', 'Gols contra', 'Saldo', 'Aproveitamento (%)'];
  const line = (row) => [row.position, csvText(names[row.id]), row.points, row.played, row.wins, row.draws, row.losses, row.goalsFor, row.goalsAgainst, row.goalDifference, decimal(row.percentage)].join(';');
  let lines;
  if (t.format === 'league') {
    lines = [header.join(';'), ...leagueStandings(t).rows.map(line)];
  } else if (t.format === 'groups') {
    lines = [['Grupo', ...header].join(';')];
    for (const { group, rows } of groupStandings(t)) lines.push(...rows.map((row) => `${group.name};${line(row)}`));
  } else {
    lines = ['Time;Situação', ...knockoutPlacement(t).map((p) => `${csvText(names[p.id])};${csvText(p.situation)}`)];
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Confere um backup importado antes de usar: estrutura, ids, referências e
 * placares. Devolve o campeonato normalizado ou lança um erro com o motivo.
 */
export function validateTournament(data) {
  const fail = (msg) => {
    throw new Error(`Backup inválido: ${msg}`);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('o arquivo não contém um objeto JSON.');
  if (data.app !== APP_ID) fail('o arquivo não foi exportado por este organizador.');
  if (data.version !== DATA_VERSION) fail(`versão ${String(data.version)} não suportada.`);
  if (!FORMATS[data.format]) fail('formato desconhecido.');
  if (typeof data.name !== 'string' || data.name.length > 80) fail('nome do campeonato inválido.');
  if (!Array.isArray(data.teams) || data.teams.length < MIN_TEAMS || data.teams.length > MAX_TEAMS) fail('lista de times inválida.');
  const ids = new Set();
  for (const team of data.teams) {
    if (!team || typeof team.id !== 'string' || !/^t\d{1,3}$/.test(team.id) || ids.has(team.id)) fail('id de time inválido ou repetido.');
    if (typeof team.name !== 'string' || !team.name.trim() || team.name.length > MAX_NAME) fail('nome de time inválido.');
    if (!Number.isInteger(team.draw) || team.draw < 0) fail('valor de sorteio inválido.');
    ids.add(team.id);
  }
  try {
    validatePoints(data.points);
  } catch (err) {
    fail(err.message);
  }
  if (!Array.isArray(data.tiebreakers) || normalizeTiebreakers(data.tiebreakers).length !== data.tiebreakers.length) fail('critérios de desempate inválidos.');
  if (!data.results || typeof data.results !== 'object' || Array.isArray(data.results)) fail('resultados inválidos.');

  const matchIds = new Set();
  const checkRounds = (rounds, members) => {
    if (!Array.isArray(rounds)) fail('rodadas inválidas.');
    for (const round of rounds) {
      if (!round || !Array.isArray(round.matches)) fail('rodada inválida.');
      if (round.bye !== null && round.bye !== undefined && !members.has(round.bye)) fail('folga com time desconhecido.');
      const inRound = new Set();
      for (const m of round.matches) {
        if (!m || typeof m.id !== 'string' || matchIds.has(m.id)) fail('jogo sem id ou repetido.');
        if (!members.has(m.home) || !members.has(m.away) || m.home === m.away) fail('jogo com time desconhecido.');
        if (inRound.has(m.home) || inRound.has(m.away)) fail('time jogando duas vezes na mesma rodada.');
        inRound.add(m.home);
        inRound.add(m.away);
        matchIds.add(m.id);
      }
    }
  };
  const checkBracket = (bracket) => {
    if (!bracket || !Array.isArray(bracket.rounds) || !bracket.rounds.length) fail('chaveamento inválido.');
    const size = bracket.size;
    if (!Number.isInteger(size) || size < 2 || nextPowerOfTwo(size) !== size) fail('tamanho de chaveamento inválido.');
    const seen = new Set();
    let expected = size / 2;
    const known = new Set();
    for (const round of bracket.rounds) {
      if (!Array.isArray(round.matches) || round.matches.length !== expected) fail('fase do chaveamento com número errado de jogos.');
      for (const m of round.matches) {
        if (!m || typeof m.id !== 'string' || !/^K\d+-\d+$/.test(m.id) || known.has(m.id)) fail('jogo do chaveamento inválido.');
        if (!Array.isArray(m.slots) || m.slots.length !== 2) fail('jogo do chaveamento sem dois lados.');
        for (const s of m.slots) {
          if (s.team !== undefined) {
            if (!ids.has(s.team) || seen.has(s.team)) fail('time inválido ou repetido no chaveamento.');
            seen.add(s.team);
          } else if (s.winner !== undefined) {
            if (!known.has(s.winner)) fail('referência inválida no chaveamento.');
          } else if (s.bye !== true) {
            fail('posição inválida no chaveamento.');
          }
        }
      }
      for (const m of round.matches) known.add(m.id);
      expected /= 2;
    }
    if (expected !== 0.5) fail('chaveamento incompleto.');
    if (bracket.thirdPlace) {
      const tp = bracket.thirdPlace;
      if (tp.id !== 'K3' || !Array.isArray(tp.slots) || tp.slots.length !== 2 || tp.slots.some((s) => !known.has(s.loser))) fail('disputa de 3º lugar inválida.');
      known.add(tp.id);
    }
    for (const m of known) matchIds.add(m);
  };

  if (data.format === 'league') {
    if (!data.league || !Array.isArray(data.league.rounds)) fail('tabela de pontos corridos ausente.');
    checkRounds(data.league.rounds, ids);
  } else if (data.format === 'knockout') {
    if (!data.knockout) fail('mata-mata ausente.');
    checkBracket(data.knockout.bracket);
  } else {
    const g = data.groups;
    if (!g || !Array.isArray(g.list) || g.list.length < 2) fail('grupos ausentes.');
    const inGroups = new Set();
    for (const group of g.list) {
      if (!Array.isArray(group.teams) || group.teams.length < 2) fail('grupo com menos de 2 times.');
      const members = new Set(group.teams);
      for (const id of group.teams) {
        if (!ids.has(id) || inGroups.has(id)) fail('time desconhecido ou em dois grupos.');
        inGroups.add(id);
      }
      checkRounds(group.rounds, members);
    }
    if (inGroups.size !== ids.size) fail('time fora de todos os grupos.');
    if (!Number.isInteger(g.advance) || g.advance < 1) fail('número de classificados inválido.');
    if (!data.knockout) fail('mata-mata ausente.');
    if (data.knockout.bracket) checkBracket(data.knockout.bracket);
  }

  for (const [id, r] of Object.entries(data.results)) {
    if (!matchIds.has(id)) fail(`resultado de jogo inexistente (${id}).`);
    if (!r || !isGoal(r.homeGoals) || !isGoal(r.awayGoals)) fail(`placar inválido no jogo ${id}.`);
    if (id.startsWith('K')) {
      if (!ids.has(r.home) || !ids.has(r.away)) fail(`times inválidos no jogo ${id}.`);
      if (!isValidKnockoutResult(r)) fail(`jogo ${id} empatado sem pênaltis válidos.`);
    }
  }
  return data;
}

export function backupJSON(t) {
  return JSON.stringify(t, null, 2);
}
