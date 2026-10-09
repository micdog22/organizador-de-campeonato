import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BYE, roundRobin, seedOrder, seedSlots, buildBracket, resolveBracket, pruneKnockoutResults, fixGroupClashes,
  distributeGroups, computeStandings, createTournament, setScore, setKnockoutResult, bracketState,
  leagueStandings, groupStandings, groupStageComplete, qualifiers, generateKnockout, reopenGroups,
  standingsCSV, validateTournament, normalizeTeamNames, knockoutPlacement, isValidKnockoutResult,
  seededRandom, shuffle, nextPowerOfTwo, roundName,
} from '../src/tournament.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const m = (home, away, homeGoals, awayGoals) => ({ home, away, homeGoals, awayGoals });
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ---------------- pontos corridos ---------------- */

test('Berger: a tabela de 6 participantes é a tabela clássica', () => {
  const rounds = roundRobin(['1', '2', '3', '4', '5', '6']);
  const text = rounds.map((r) => r.matches.map((x) => `${x.home}-${x.away}`).join(' ')).join(' | ');
  assert.equal(text, '1-6 2-5 3-4 | 6-4 1-2 5-3 | 2-6 3-1 4-5 | 6-5 1-4 2-3 | 3-6 5-1 4-2');
});

test('pontos corridos: cada par se enfrenta uma vez e ninguém joga duas vezes na rodada (2 a 24 times)', () => {
  for (let n = 2; n <= 24; n++) {
    const teams = ids(n);
    const rounds = roundRobin(teams);
    assert.equal(rounds.length, n % 2 === 0 ? n - 1 : n, `${n} times: número de rodadas`);
    const pairs = new Map();
    const home = new Map(teams.map((t) => [t, 0]));
    const byes = new Map(teams.map((t) => [t, 0]));
    for (const round of rounds) {
      const seen = new Set();
      for (const { home: h, away: a } of round.matches) {
        assert.notEqual(h, a);
        assert.ok(!seen.has(h) && !seen.has(a), `${n} times: alguém jogou duas vezes na rodada`);
        seen.add(h);
        seen.add(a);
        pairs.set(pairKey(h, a), (pairs.get(pairKey(h, a)) || 0) + 1);
        home.set(h, home.get(h) + 1);
      }
      if (n % 2 === 1) {
        assert.ok(round.bye, `${n} times: rodada sem folga`);
        assert.ok(!seen.has(round.bye), 'quem folga não joga');
        byes.set(round.bye, byes.get(round.bye) + 1);
        assert.equal(seen.size, n - 1);
      } else {
        assert.equal(round.bye, null);
        assert.equal(seen.size, n);
      }
    }
    assert.equal(pairs.size, (n * (n - 1)) / 2);
    assert.ok([...pairs.values()].every((c) => c === 1));
    if (n % 2 === 1) assert.ok([...byes.values()].every((c) => c === 1), 'cada time folga exatamente uma vez');
    const games = n % 2 === 0 ? n - 1 : n - 1;
    for (const [team, h] of home) assert.ok(Math.abs(2 * h - games) <= 1, `${n} times: mandos de ${team} desequilibrados (${h})`);
  }
});

test('pontos corridos: quebras de mando no mínimo teórico (n - 2)', () => {
  for (const n of [4, 6, 8, 10, 12, 16, 20]) {
    const teams = ids(n);
    const seq = new Map(teams.map((t) => [t, []]));
    for (const round of roundRobin(teams)) {
      for (const x of round.matches) {
        seq.get(x.home).push('M');
        seq.get(x.away).push('V');
      }
    }
    let breaks = 0;
    for (const s of seq.values()) for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) breaks++;
    assert.equal(breaks, n - 2, `${n} times`);
  }
});

test('turno e returno: cada par duas vezes, uma em cada mando', () => {
  for (const n of [3, 4, 7, 10]) {
    const rounds = roundRobin(ids(n), { double: true });
    assert.equal(rounds.length, 2 * (n % 2 === 0 ? n - 1 : n));
    const ordered = new Map();
    for (const round of rounds) {
      const seen = new Set();
      for (const x of round.matches) {
        assert.ok(!seen.has(x.home) && !seen.has(x.away));
        seen.add(x.home);
        seen.add(x.away);
        const key = `${x.home}>${x.away}`;
        ordered.set(key, (ordered.get(key) || 0) + 1);
      }
    }
    assert.equal(ordered.size, n * (n - 1), 'cada time recebe cada adversário uma vez');
    assert.ok([...ordered.values()].every((c) => c === 1));
    const half = rounds.length / 2;
    for (let r = 0; r < half; r++) assert.equal(rounds[r].bye, rounds[r + half].bye);
  }
  assert.deepEqual(roundRobin(['a']), []);
});

/* ---------------- mata-mata ---------------- */

test('ordem dos cabeças de chave', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(seedOrder(16), [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  for (const size of [4, 8, 16, 32, 64]) {
    const order = seedOrder(size);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
    // Cada confronto da primeira fase soma size + 1 (1 x último, 2 x penúltimo...).
    for (let i = 0; i < size; i += 2) assert.equal(order[i] + order[i + 1], size + 1);
    // 1 e 2 em metades opostas; 1 a 4 em quartos diferentes.
    const pos = (s) => order.indexOf(s);
    assert.notEqual(Math.floor(pos(1) / (size / 2)), Math.floor(pos(2) / (size / 2)));
    assert.equal(new Set([1, 2, 3, 4].map((s) => Math.floor(pos(s) / (size / 4)))).size, 4);
  }
  assert.equal(nextPowerOfTwo(5), 8);
  assert.equal(nextPowerOfTwo(8), 8);
  assert.equal(roundName(1), 'Final');
  assert.equal(roundName(4), 'Quartas de final');
  assert.equal(roundName(16), 'Fase de 32');
});

test('folgas até a próxima potência de 2, sempre para os melhores cabeças de chave', () => {
  for (let n = 2; n <= 64; n++) {
    const slots = seedSlots(ids(n));
    const size = nextPowerOfTwo(n);
    assert.equal(slots.length, size);
    assert.equal(slots.filter((s) => s === null).length, size - n);
    for (let i = 0; i < size; i += 2) {
      assert.ok(!(slots[i] === null && slots[i + 1] === null), 'nunca folga contra folga');
      if (slots[i + 1] === null) assert.ok(Number(slots[i].slice(1)) <= size - n, `n=${n}: folga para quem não é cabeça de chave`);
    }
  }
  const five = seedSlots(ids(5));
  assert.deepEqual(five, ['t1', null, 't4', 't5', 't2', null, 't3', null]);
});

test('chaveamento: avanço com folgas, resultados, pênaltis e campeão', () => {
  const bracket = buildBracket(seedSlots(ids(5)), { thirdPlace: true });
  assert.deepEqual(bracket.rounds.map((r) => r.name), ['Quartas de final', 'Semifinal', 'Final']);
  let results = {};
  let state = resolveBracket(bracket, results);
  const q = state.rounds[0].matches;
  assert.deepEqual(q.map((x) => x.status), ['bye', 'ready', 'bye', 'bye']);
  assert.deepEqual(q.map((x) => x.winner), ['t1', null, 't2', 't3']);
  assert.equal(state.rounds[1].matches[0].status, 'pending');
  assert.equal(state.rounds[1].matches[1].status, 'ready');
  assert.deepEqual([state.rounds[1].matches[1].home, state.rounds[1].matches[1].away], ['t2', 't3']);

  results['K1-2'] = { home: 't4', away: 't5', homeGoals: 1, awayGoals: 1, homePens: 3, awayPens: 4 };
  state = resolveBracket(bracket, results);
  assert.equal(state.rounds[0].matches[1].winner, 't5', 'pênaltis decidem');
  assert.deepEqual([state.rounds[1].matches[0].home, state.rounds[1].matches[0].away], ['t1', 't5']);

  results['K2-1'] = { home: 't1', away: 't5', homeGoals: 0, awayGoals: 2 };
  results['K2-2'] = { home: 't2', away: 't3', homeGoals: 3, awayGoals: 1 };
  state = resolveBracket(bracket, results);
  assert.equal(state.thirdPlace.status, 'ready');
  assert.deepEqual([state.thirdPlace.home, state.thirdPlace.away], ['t1', 't3']);
  assert.deepEqual([state.rounds[2].matches[0].home, state.rounds[2].matches[0].away], ['t5', 't2']);
  results['K3-1'] = { home: 't5', away: 't2', homeGoals: 2, awayGoals: 2, homePens: 5, awayPens: 3 };
  results.K3 = { home: 't1', away: 't3', homeGoals: 4, awayGoals: 0 };
  state = resolveBracket(bracket, results);
  assert.equal(state.champion, 't5');
  assert.equal(state.runnerUp, 't2');
  assert.equal(state.third, 't1');

  // Mudou um resultado lá atrás: os jogos seguintes perdem o resultado antigo.
  results['K1-2'] = { home: 't4', away: 't5', homeGoals: 2, awayGoals: 0 };
  const pruned = pruneKnockoutResults(bracket, results);
  assert.ok(!('K2-1' in pruned), 'semifinal com outro adversário volta a ficar aberta');
  assert.ok(!('K3-1' in pruned), 'final dependia da semifinal');
  assert.ok(!('K3' in pruned), 'disputa de 3º dependia da semifinal');
  assert.ok('K2-2' in pruned, 'a outra semifinal continua valendo');
  state = resolveBracket(bracket, pruned);
  assert.deepEqual([state.rounds[1].matches[0].home, state.rounds[1].matches[0].away], ['t1', 't4']);
  assert.equal(state.champion, null);
});

test('chaveamento cheio: todos os jogos, todas as potências de 2', () => {
  for (const n of [2, 3, 4, 6, 8, 11, 16, 23, 32]) {
    const bracket = buildBracket(seedSlots(ids(n)), { thirdPlace: n >= 4 });
    const rng = seededRandom(n);
    let results = {};
    for (let guard = 0; guard < 200; guard++) {
      const state = resolveBracket(bracket, results);
      const ready = [...state.matches.values()].filter((x) => x.status === 'ready');
      if (!ready.length) break;
      for (const x of ready) {
        const hg = Math.floor(rng() * 4);
        const ag = Math.floor(rng() * 4);
        results[x.id] = hg === ag
          ? { home: x.home, away: x.away, homeGoals: hg, awayGoals: ag, homePens: 5, awayPens: 4 }
          : { home: x.home, away: x.away, homeGoals: hg, awayGoals: ag };
      }
    }
    const state = resolveBracket(bracket, results);
    assert.ok(state.champion && state.champion !== BYE, `${n} times têm campeão`);
    const played = [...state.matches.values()].filter((x) => x.status === 'played').length;
    const expectedThird = bracket.thirdPlace ? 1 : 0;
    assert.equal(played, n - 1 + expectedThird, `${n} times: n - 1 jogos eliminatórios`);
    if (n === 3) assert.equal(bracket.thirdPlace, null, 'com 3 times a semifinal tem folga e não há 3º lugar');
  }
});

test('resultado de mata-mata precisa de vencedor', () => {
  assert.equal(isValidKnockoutResult({ homeGoals: 1, awayGoals: 0 }), true);
  assert.equal(isValidKnockoutResult({ homeGoals: 1, awayGoals: 1 }), false);
  assert.equal(isValidKnockoutResult({ homeGoals: 1, awayGoals: 1, homePens: 4, awayPens: 4 }), false);
  assert.equal(isValidKnockoutResult({ homeGoals: 1, awayGoals: 1, homePens: 4, awayPens: 2 }), true);
  assert.equal(isValidKnockoutResult({ homeGoals: -1, awayGoals: 0 }), false);
  assert.equal(isValidKnockoutResult({ homeGoals: 1.5, awayGoals: 0 }), false);
});

/* ---------------- classificação ---------------- */

const draws = { A: 10, B: 20, C: 30, D: 40, E: 50, X: 60, Y: 70, P1: 1, P2: 2, P3: 3 };

test('classificação: contagem de pontos, saldo e aproveitamento', () => {
  const { rows } = computeStandings(['A', 'B', 'C'], [m('A', 'B', 2, 0), m('B', 'C', 1, 1), m('C', 'A', 0, 3), m('A', 'C', null, null)], { drawValues: draws });
  assert.deepEqual(rows.map((r) => r.id), ['A', 'B', 'C'], 'B e C com 1 ponto: B tem saldo -2, C tem -3');
  const a = rows[0];
  assert.deepEqual([a.points, a.played, a.wins, a.draws, a.losses, a.goalsFor, a.goalsAgainst, a.goalDifference], [6, 2, 2, 0, 0, 5, 0, 5]);
  assert.equal(a.percentage, 100);
  assert.equal(rows[1].points, 1);
  assert.ok(Math.abs(rows[1].percentage - 16.666) < 0.01);
  const twoPoints = computeStandings(['A', 'B'], [m('A', 'B', 1, 0)], { points: { win: 2, draw: 1, loss: 0 } });
  assert.equal(twoPoints.rows[0].points, 2);
});

test('desempate por vitórias', () => {
  const games = [m('X', 'P1', 1, 0), m('P2', 'X', 1, 0), m('Y', 'P1', 1, 1), m('Y', 'P2', 0, 0), m('Y', 'P3', 0, 0)];
  const teams = ['X', 'Y', 'P1', 'P2', 'P3'];
  const { rows, notes } = computeStandings(teams, games, { drawValues: { ...draws, Y: 999 } });
  const x = rows.find((r) => r.id === 'X');
  const y = rows.find((r) => r.id === 'Y');
  assert.deepEqual([x.points, x.goalDifference, x.goalsFor], [y.points, y.goalDifference, y.goalsFor], 'iguais em tudo menos vitórias');
  assert.ok(x.position < y.position);
  assert.deepEqual(notes.find((n) => n.ahead === 'X'), { ahead: 'X', behind: 'Y', criterion: 'wins' });
  // Sem o critério de vitórias, sobra o sorteio (Y tem o número maior).
  const noWins = computeStandings(teams, games, { tiebreakers: ['goalDifference', 'goalsFor', 'headToHead'], drawValues: { ...draws, Y: 999 } });
  assert.ok(noWins.rows.findIndex((r) => r.id === 'Y') < noWins.rows.findIndex((r) => r.id === 'X'));
  assert.equal(noWins.notes.find((n) => n.ahead === 'Y').criterion, 'draw');
});

test('desempate por saldo de gols e por gols pró', () => {
  const bySaldo = computeStandings(['X', 'Y', 'P1', 'P2'], [m('X', 'P1', 3, 0), m('Y', 'P2', 1, 0)], { drawValues: draws });
  assert.deepEqual(bySaldo.rows.slice(0, 2).map((r) => r.id), ['X', 'Y']);
  assert.equal(bySaldo.notes[0].criterion, 'goalDifference');
  const byGoals = computeStandings(['X', 'Y', 'P1', 'P2'], [m('X', 'P1', 2, 1), m('Y', 'P2', 4, 3)], { drawValues: { ...draws, X: 999 } });
  assert.deepEqual(byGoals.rows.slice(0, 2).map((r) => r.id), ['Y', 'X']);
  assert.equal(byGoals.notes[0].criterion, 'goalsFor');
});

test('desempate por confronto direto entre dois', () => {
  const { rows, notes } = computeStandings(['X', 'Y', 'P1', 'P2'], [m('Y', 'X', 0, 1), m('X', 'P1', 0, 1), m('Y', 'P2', 1, 0)], { drawValues: { ...draws, Y: 999 } });
  const x = rows.find((r) => r.id === 'X');
  const y = rows.find((r) => r.id === 'Y');
  assert.deepEqual([x.points, x.wins, x.goalDifference, x.goalsFor], [y.points, y.wins, y.goalDifference, y.goalsFor]);
  assert.ok(x.position < y.position, 'X venceu o confronto direto');
  assert.equal(notes.find((n) => n.ahead === 'X').criterion, 'headToHead');
});

test('confronto direto entre três empatados (minitabela)', () => {
  // A, B e C terminam com 7 pontos, 2 vitórias, saldo +1 e 2 gols pró.
  // Entre eles: A 1x0 B, B 1x0 C, A 0x0 C. Minitabela: A 4, B 3, C 1.
  const games = [
    m('A', 'B', 1, 0), m('B', 'C', 1, 0), m('C', 'A', 0, 0),
    m('A', 'D', 1, 0), m('E', 'A', 1, 0),
    m('B', 'D', 1, 0), m('B', 'E', 0, 0),
    m('C', 'D', 1, 0), m('C', 'E', 1, 0),
    m('D', 'E', 2, 2),
  ];
  const { rows, notes } = computeStandings(['A', 'B', 'C', 'D', 'E'], games, { drawValues: { ...draws, C: 9999 } });
  const top = rows.slice(0, 3);
  for (const r of top) assert.deepEqual([r.points, r.wins, r.goalDifference, r.goalsFor], [7, 2, 1, 2], r.id);
  assert.deepEqual(rows.map((r) => r.id), ['A', 'B', 'C', 'E', 'D']);
  assert.deepEqual(notes.filter((n) => n.criterion === 'headToHead'), [
    { ahead: 'A', behind: 'B', criterion: 'headToHead' },
    { ahead: 'B', behind: 'C', criterion: 'headToHead' },
  ]);
});

test('confronto direto é recalculado entre os que continuam empatados', () => {
  // Ciclo entre A, B e C (todos 1x0): a minitabela dos três empata.
  // Gols pró separam C; entre A e B, que seguem empatados, vale o jogo deles: A 1x0 B.
  const games = [m('A', 'B', 1, 0), m('B', 'C', 1, 0), m('C', 'A', 1, 0), m('A', 'D', 1, 1), m('B', 'D', 1, 1), m('C', 'D', 3, 3)];
  const { rows, notes } = computeStandings(['A', 'B', 'C', 'D'], games, { tiebreakers: ['headToHead', 'goalsFor'], drawValues: { ...draws, B: 9999 } });
  assert.deepEqual(rows.map((r) => r.id), ['C', 'A', 'B', 'D']);
  assert.deepEqual(notes, [
    { ahead: 'C', behind: 'A', criterion: 'goalsFor' },
    { ahead: 'A', behind: 'B', criterion: 'headToHead' },
  ]);
});

test('a ordem dos critérios é configurável', () => {
  // X: mais vitórias. Y: mais gols e melhor saldo.
  const games = [m('X', 'P1', 1, 0), m('P2', 'X', 3, 0), m('Y', 'P1', 3, 3), m('Y', 'P2', 0, 0), m('Y', 'P3', 0, 0)];
  const teams = ['X', 'Y', 'P1', 'P2', 'P3'];
  const order = (tiebreakers) => computeStandings(teams, games, { tiebreakers, drawValues: draws }).rows.map((r) => r.id).filter((id) => id === 'X' || id === 'Y');
  assert.deepEqual(order(['wins', 'goalDifference']), ['X', 'Y']);
  assert.deepEqual(order(['goalDifference', 'wins']), ['Y', 'X']);
  assert.deepEqual(order(['goalsFor', 'wins']), ['Y', 'X']);
});

test('sorteio decide o empate total e é estável', () => {
  const { rows, notes } = computeStandings(['X', 'Y'], [m('X', 'Y', 1, 1)], { drawValues: { X: 5, Y: 9 } });
  assert.deepEqual(rows.map((r) => r.id), ['Y', 'X']);
  assert.deepEqual(notes, [{ ahead: 'Y', behind: 'X', criterion: 'draw' }]);
});

/* ---------------- campeonato ---------------- */

test('nomes de times: limpeza, repetidos e limites', () => {
  assert.deepEqual(normalizeTeamNames('  Unidos  da Vila \n\nEstrela do Norte\n'), ['Unidos da Vila', 'Estrela do Norte']);
  assert.throws(() => normalizeTeamNames('Só um'), /pelo menos 2/);
  assert.throws(() => normalizeTeamNames('Leões\nleões'), /repetido/);
  assert.throws(() => normalizeTeamNames(Array.from({ length: 65 }, (_, i) => `Time ${i}`)), /limite/);
  assert.throws(() => normalizeTeamNames(['A'.repeat(41), 'B']), /longo/);
});

test('pontos corridos completo: placares, classificação e CSV', () => {
  let t = createTournament({ name: 'Copa do Bairro', format: 'league', teams: 'Unidos da Vila\nEstrela do Norte\n=Atlético Ipê\nReal; Jacarandá' }, seededRandom(1));
  assert.equal(t.league.rounds.length, 3);
  const first = t.league.rounds[0].matches[0];
  t = setScore(t, first.id, '2', '1');
  assert.deepEqual(t.results[first.id], { homeGoals: 2, awayGoals: 1 });
  t = setScore(t, first.id, '', '1');
  assert.ok(!(first.id in t.results), 'campo vazio apaga o placar');
  assert.throws(() => setScore(t, first.id, '-1', '0'), /inválido/);
  assert.throws(() => setScore(t, 'L9-9', '1', '0'), /inexistente/);
  for (const round of t.league.rounds) for (const x of round.matches) t = setScore(t, x.id, 1, 0);
  const { rows } = leagueStandings(t);
  assert.equal(rows.reduce((s, r) => s + r.played, 0), 12);
  assert.equal(rows.reduce((s, r) => s + r.points, 0), 18);
  const csv = standingsCSV(t);
  assert.ok(csv.startsWith('\uFEFFPosição;Time;Pontos'));
  assert.ok(csv.includes(";'=Atlético Ipê;"), 'nome que parece fórmula ganha apóstrofo');
  assert.ok(csv.includes(';"Real; Jacarandá";'), 'ponto e vírgula vai entre aspas');
  assert.ok(/;\d+,\d\r\n/.test(csv), 'aproveitamento com vírgula decimal');
  assert.equal(csv.split('\r\n').length, 6);
});

test('distribuição dos grupos em serpentina', () => {
  assert.deepEqual(distributeGroups(['1', '2', '3', '4', '5', '6', '7', '8'], 3), [['1', '6', '7'], ['2', '5', '8'], ['3', '4']]);
  assert.deepEqual(distributeGroups(['1', '2', '3', '4'], 2), [['1', '4'], ['2', '3']]);
});

function playAll(t, rng) {
  let out = t;
  for (const g of out.groups.list) {
    for (const round of g.rounds) {
      for (const x of round.matches) out = setScore(out, x.id, Math.floor(rng() * 4), Math.floor(rng() * 4));
    }
  }
  return out;
}

test('grupos + mata-mata: classificados, cabeças de chave e nenhum confronto do mesmo grupo na estreia', () => {
  const rng = seededRandom(99);
  for (let groupsCount = 2; groupsCount <= 8; groupsCount++) {
    for (let advance = 1; advance <= 3; advance++) {
      const teamCount = groupsCount * (advance + 1) + (groupsCount % 3);
      if (teamCount > 64) continue;
      const names = Array.from({ length: teamCount }, (_, i) => `Time ${i + 1}`);
      let t = createTournament({ format: 'groups', teams: names, groupCount: groupsCount, advance, thirdPlace: true }, rng);
      assert.equal(groupStageComplete(t), false);
      assert.throws(() => generateKnockout(t), /ainda não terminou/);
      t = playAll(t, rng);
      assert.equal(groupStageComplete(t), true);
      const q = qualifiers(t);
      assert.equal(q.length, groupsCount * advance);
      for (let i = 1; i < q.length; i++) assert.ok(q[i - 1].position <= q[i].position, 'primeiro todos os 1ºs, depois os 2ºs');
      t = generateKnockout(t);
      const state = bracketState(t);
      const firstRound = state.rounds[0].matches;
      const groupOf = new Map(t.groups.list.flatMap((g) => g.teams.map((id) => [id, g.name])));
      for (const x of firstRound) {
        if (x.status === 'bye') continue;
        assert.notEqual(groupOf.get(x.home), groupOf.get(x.away), `${groupsCount} grupos, ${advance} por grupo: ${x.home} x ${x.away}`);
      }
      const inBracket = new Set(firstRound.flatMap((x) => [x.home, x.away]).filter((x) => x !== BYE));
      assert.deepEqual([...inBracket].sort(), q.map((e) => e.team).sort());
      // Com o mata-mata gerado, os grupos ficam travados até reabrir.
      const someGroupMatch = t.groups.list[0].rounds[0].matches[0].id;
      assert.throws(() => setScore(t, someGroupMatch, 0, 0), /Reabra/);
      const reopened = reopenGroups(t);
      assert.equal(reopened.knockout.bracket, null);
      assert.ok(Object.keys(reopened.results).every((id) => !id.startsWith('K')));
    }
  }
});

test('troca de adversários quando dois do mesmo grupo cairiam juntos', () => {
  const e = (team, group, position) => ({ team, group, position });
  // 3 grupos, 2 por grupo: pela ordem pura, 1º C pegaria 2º C.
  const seeds = [e('a1', 'A', 1), e('b1', 'B', 1), e('c1', 'C', 1), e('a2', 'A', 2), e('b2', 'B', 2), e('c2', 'C', 2)];
  const raw = seedSlots(seeds);
  assert.ok(raw.some((s, i) => i % 2 === 0 && s && raw[i + 1] && s.group === raw[i + 1].group), 'o choque existe antes da correção');
  const fixed = fixGroupClashes(raw);
  for (let i = 0; i < fixed.length; i += 2) {
    if (fixed[i] && fixed[i + 1]) assert.notEqual(fixed[i].group, fixed[i + 1].group);
  }
  assert.deepEqual(fixed.map((s) => (s ? s.team : null)).filter((x) => x && x.endsWith('1')).sort(), ['a1', 'b1', 'c1']);
  assert.equal(fixed.filter((s) => s === null).length, 2, 'as folgas continuam com os melhores');
});

test('mata-mata pela interface de dados: lançar, corrigir, pênaltis e situação final', () => {
  let t = createTournament({ format: 'knockout', teams: ['Leões da Serra', 'Atlético Ipê', 'Unidos da Vila', 'Estrela do Norte'], thirdPlace: true }, seededRandom(5));
  let state = bracketState(t);
  const [semi1, semi2] = state.rounds[0].matches;
  assert.deepEqual([semi1.home, semi1.away, semi2.home, semi2.away], ['t1', 't4', 't2', 't3']);
  assert.throws(() => setKnockoutResult(t, 'K2-1', { homeGoals: 1, awayGoals: 0 }), /adversários/);
  assert.throws(() => setKnockoutResult(t, 'K1-1', { homeGoals: 1, awayGoals: 1 }), /pênaltis/);
  t = setKnockoutResult(t, 'K1-1', { homeGoals: 1, awayGoals: 1, homePens: 2, awayPens: 4 });
  t = setKnockoutResult(t, 'K1-2', { homeGoals: 3, awayGoals: 0 });
  t = setKnockoutResult(t, 'K2-1', { homeGoals: 0, awayGoals: 1 });
  t = setKnockoutResult(t, 'K3', { homeGoals: 2, awayGoals: 1 });
  state = bracketState(t);
  assert.equal(state.champion, 't2');
  assert.equal(state.runnerUp, 't4');
  assert.equal(state.third, 't1');
  const placement = Object.fromEntries(knockoutPlacement(t).map((p) => [p.id, p.situation]));
  assert.deepEqual(placement, { t1: '3º lugar', t2: 'Campeão', t3: '4º lugar', t4: 'Vice-campeão' });
  // Corrigir a primeira semifinal muda a final: o resultado antigo da final some.
  t = setKnockoutResult(t, 'K1-1', { homeGoals: 2, awayGoals: 0 });
  state = bracketState(t);
  assert.equal(state.champion, null);
  assert.ok(!('K2-1' in t.results));
  assert.ok(!('K3' in t.results));
  assert.equal(state.rounds[1].matches[0].home, 't1');
  const csv = standingsCSV(t);
  assert.ok(csv.startsWith('\uFEFFTime;Situação\r\n'));
});

test('backup: aceita o que foi exportado e recusa arquivos adulterados', () => {
  const rng = seededRandom(7);
  const samples = [
    createTournament({ format: 'league', teams: ids(7), double: true }, rng),
    createTournament({ format: 'knockout', teams: ids(11), thirdPlace: true, seeding: 'random' }, rng),
    generateKnockout(playAll(createTournament({ format: 'groups', teams: ids(12), groupCount: 3, advance: 2 }, rng), rng)),
  ];
  for (const t of samples) {
    const copy = JSON.parse(JSON.stringify(t));
    assert.deepEqual(validateTournament(copy), copy);
  }
  const bad = (mutate, pattern) => {
    const copy = JSON.parse(JSON.stringify(samples[0]));
    mutate(copy);
    assert.throws(() => validateTournament(copy), pattern);
  };
  bad((c) => { c.app = 'outro'; }, /não foi exportado/);
  bad((c) => { c.teams[1].id = c.teams[0].id; }, /repetido/);
  bad((c) => { c.teams[0].name = ''; }, /nome de time/);
  bad((c) => { c.results['L99-1'] = { homeGoals: 1, awayGoals: 0 }; }, /inexistente/);
  bad((c) => { c.results[c.league.rounds[0].matches[0].id] = { homeGoals: 1.5, awayGoals: 0 }; }, /placar/);
  bad((c) => { c.league.rounds[0].matches[0].away = c.league.rounds[0].matches[0].home; }, /desconhecido/);
  bad((c) => { c.points = { win: 1, draw: 3, loss: 0 }; }, /vitória/);
  bad((c) => { c.tiebreakers = ['wins', 'wins']; }, /desempate/);
  const ko = JSON.parse(JSON.stringify(samples[1]));
  ko.knockout.bracket.rounds[0].matches[0].slots[0] = { team: 't99' };
  assert.throws(() => validateTournament(ko), /chaveamento/);
  assert.throws(() => validateTournament(null), /objeto/);
  assert.throws(() => validateTournament([]), /objeto/);
});

test('criação: limites de grupos, classificados e pontuação', () => {
  assert.throws(() => createTournament({ format: 'groups', teams: ids(6), groupCount: 4 }), /de 2 a 3 grupos/);
  assert.throws(() => createTournament({ format: 'groups', teams: ids(6), groupCount: 3, advance: 2 }), /de 1 a 1/);
  assert.throws(() => createTournament({ format: 'league', teams: ids(4), points: { win: 1, draw: 1, loss: 0 } }), /vitória/);
  assert.throws(() => createTournament({ format: 'copa', teams: ids(4) }), /Formato/);
  const t = createTournament({ format: 'league', teams: ids(5) }, seededRandom(3));
  assert.equal(new Set(t.teams.map((x) => x.draw)).size, 5, 'números de sorteio distintos');
  const shuffled = shuffle(ids(10), seededRandom(4));
  assert.deepEqual([...shuffled].sort(), ids(10).sort());
  const groups = createTournament({ format: 'groups', teams: ids(9), groupCount: 3, advance: 1 }, seededRandom(8));
  assert.deepEqual(groupStandings(groups).map((g) => g.rows.length), [3, 3, 3]);
});
