import { describe, expect, it } from 'vitest';
import { canEndPhaseEarly, createGame, submitDayVote, submitNightAction, tallyVotes } from '../engine';
import { seededRng } from '../rng';
import { checkMainVictory } from '../victory';
import { eventsOf, privateTo, TestGame } from './helpers';

describe('Ovoz berish (§5.6)', () => {
  it('teng ovoz → hech kim chiqarilmaydi', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.toVoting();
    const [a, b, c, d] = [g.id('CITIZEN', 0), g.id('CITIZEN', 1), g.id('CITIZEN', 2), g.id('CITIZEN', 3)];
    g.vote(a, b);
    g.vote(c, b);
    g.vote(b, a);
    g.vote(d, a);
    expect(tallyVotes(g.state).candidateId).toBeNull();
    const ev = g.advance();
    expect(eventsOf(ev, 'VOTE_RESULT')[0]!.candidateId).toBeNull();
    expect(g.state.players.every((p) => p.status === 'ALIVE')).toBe(true);
  });

  it('kamida 2 og‘irlik kerak', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.toVoting();
    g.vote(g.id('CITIZEN', 0), g.id('DON'));
    expect(tallyVotes(g.state).candidateId).toBeNull();
    g.vote(g.id('CITIZEN', 1), g.id('DON'));
    expect(tallyVotes(g.state).candidateId).toBe(g.id('DON'));
  });

  it('“Hech kim” tanlovidan ko‘p ovoz olishi kerak', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.toVoting();
    g.vote(g.id('CITIZEN', 0), g.id('DON'));
    g.vote(g.id('CITIZEN', 1), g.id('DON'));
    g.vote(g.id('CITIZEN', 2), 'NONE');
    g.vote(g.id('CITIZEN', 3), 'NONE');
    expect(tallyVotes(g.state).candidateId).toBeNull();
  });

  it('o‘ziga ovoz bera olmaydi, ovozni o‘zgartirish mumkin, takroriy ovoz ikki hisoblanmaydi', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.toVoting();
    const a = g.id('CITIZEN');
    const r = submitDayVote(g.state, a, a);
    expect(r.ok).toBe(false);
    g.vote(a, g.id('DON'));
    g.vote(a, g.id('DON'));
    expect(tallyVotes(g.state).tally[0]!.weight).toBe(1);
    g.vote(a, g.id('CITIZEN', 1));
    expect(tallyVotes(g.state).tally.find((t) => t.targetId === g.id('DON'))).toBeUndefined();
  });

  it('Mer e’lon qilgach 2 ovoz', () => {
    const g = new TestGame(['DON', 'MAYOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.revealMayor(g.id('MAYOR'));
    g.toVoting();
    g.vote(g.id('MAYOR'), g.id('DON'));
    expect(tallyVotes(g.state).candidateId).toBe(g.id('DON'));
  });

  it('Sudya yo‘q bo‘lsa hukm bosqichi o‘tkazib yuboriladi (Q13)', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    const c = g.id('CITIZEN', 4);
    g.voteOut(c);
    expect(g.p(c).status).toBe('DEAD');
    expect(g.state.phase).toBe('NIGHT');
  });

  it('Sudya veto ishlatmasa nomzod chiqariladi', () => {
    const g = new TestGame(['DON', 'JUDGE', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    const c = g.id('CITIZEN', 0);
    g.voteOut(c);
    expect(g.state.phase).toBe('DAY_VERDICT');
    g.advance();
    expect(g.p(c).status).toBe('DEAD');
  });
});

describe('G‘alaba shartlari (§14)', () => {
  it('Shahar g‘alabasi: Mafia qolmasa', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    const ev = g.voteOut(g.id('DON'));
    const end = eventsOf(ev, 'GAME_ENDED')[0]!;
    expect(end.result.outcome).toBe('CITY');
    expect(end.result.players.find((p) => p.role === 'DON')!.outcome).toBe('LOSS');
    expect(end.result.players.find((p) => p.role === 'CITIZEN')!.outcome).toBe('WIN');
    expect(g.state.status).toBe('FINISHED');
  });

  it('Mafia g‘alabasi: paritet (§14.2)', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('CITIZEN', 0));
    g.endNight();
    expect(g.state.status).toBe('RUNNING');
    g.skipDay();
    const ev = (g.mafia(g.id('DON'), g.id('CITIZEN', 1)), g.endNight());
    expect(eventsOf(ev, 'GAME_ENDED')[0]!.result.outcome).toBe('MAFIA');
  });

  it('Manyak mavjud bo‘lsa Mafia paritet g‘alabasi yo‘q; 2 kishi qolsa Manyak yutadi (Q12)', () => {
    const g = new TestGame(['DON', 'SERIAL_KILLER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('CITIZEN', 0));
    g.act(g.id('SERIAL_KILLER'), 'SERIAL_KILLER_KILL', g.id('CITIZEN', 1));
    g.endNight();
    // 3 tirik: DON, SK, CITIZEN → davom
    expect(g.state.status).toBe('RUNNING');
    g.skipDay();
    g.mafia(g.id('DON'), g.id('CITIZEN', 2));
    const ev = g.endNight();
    expect(eventsOf(ev, 'GAME_ENDED')[0]!.result.outcome).toBe('SERIAL_KILLER');
  });

  it('Maksimal sikl → durrang', () => {
    const g = new TestGame(['DON', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN'], { maxCycles: 3 });
    for (let i = 0; i < 3; i++) {
      g.mafia(g.id('DON'), null);
      g.endNight();
      g.skipDay();
    }
    expect(g.state.status).toBe('FINISHED');
    expect(g.state.result!.outcome).toBe('DRAW');
    expect(g.state.result!.reason).toBe('MAX_CYCLES');
  });

  it('Don + xavfsiz mustaqil qolsa → Mafia paritet g‘alabasi', () => {
    const g = new TestGame(['DON', 'JESTER', 'CITIZEN', 'CITIZEN']);
    g.state.players.find((p) => p.role === 'CITIZEN')!.status = 'DEAD';
    g.mafia(g.id('DON'), g.id('CITIZEN', 1));
    g.endNight();
    expect(g.state.result!.outcome).toBe('MAFIA');
    expect(g.state.result!.players.find((p) => p.role === 'JESTER')!.outcome).toBe('LOSS');
  });

  it('Faqat xavfsiz mustaqil qolsa → durrang', () => {
    const g = new TestGame(['DON', 'JESTER', 'THIEF', 'CITIZEN']);
    for (const p of g.state.players) if (p.role === 'DON' || p.role === 'CITIZEN') p.status = 'DEAD';
    expect(checkMainVictory(g.state)).toBe('DRAW');
  });

  it('Yolg‘iz bo‘ri: tirik ≤ 4 tongda shaxsiy g‘alaba', () => {
    const g = new TestGame(['DON', 'LONE_WOLF', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('CITIZEN'));
    const ev = g.endNight();
    expect(eventsOf(ev, 'PERSONAL_WIN')[0]!.role).toBe('LONE_WOLF');
  });

  it('O‘g‘ri: 3 muvaffaqiyatli o‘g‘rilik → g‘alaba', () => {
    const g = new TestGame(['DON', 'THIEF', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const targets = [g.id('CITIZEN', 0), g.id('CITIZEN', 1), g.id('CITIZEN', 2)];
    let personal = 0;
    for (const t of targets) {
      g.act(g.id('THIEF'), 'THIEF_STEAL', t);
      g.mafia(g.id('DON'), null);
      const ev = g.endNight();
      personal += eventsOf(ev, 'PERSONAL_WIN').length;
      if (g.state.status === 'RUNNING' && g.state.phase === 'DAY_DISCUSSION') g.skipDay();
    }
    expect(personal).toBe(1);
    expect(g.p(g.id('THIEF')).status).toBe('PERSONAL_WIN_EXIT');
  });

  it('Sehrgar: ikkala sehr + 3-tun tongida tirik → g‘alaba', () => {
    const g = new TestGame(['DON', 'WIZARD', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('WIZARD'), 'WIZARD_MIRAGE', g.id('WIZARD'));
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.skipDay();
    g.act(g.id('WIZARD'), 'WIZARD_BARRIER', g.id('WIZARD'));
    g.mafia(g.id('DON'), null);
    let ev = g.endNight();
    expect(eventsOf(ev, 'PERSONAL_WIN')).toHaveLength(0);
    g.skipDay();
    g.mafia(g.id('DON'), null);
    ev = g.endNight();
    expect(eventsOf(ev, 'PERSONAL_WIN')[0]!.role).toBe('WIZARD');
  });
});

describe('Rol cheklovlari', () => {
  it('Doktor o‘zini faqat bir marta davolaydi, bir odamni ketma-ket ikki kecha davolay olmaydi', () => {
    const g = new TestGame(['DON', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const doc = g.id('DOCTOR');
    g.act(doc, 'DOCTOR_HEAL', doc);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.skipDay();
    expect(submitNightAction(g.state, { actorId: doc, kind: 'DOCTOR_HEAL', targetIds: [doc], now: 0 }).ok).toBe(false);
    const c = g.id('CITIZEN');
    g.act(doc, 'DOCTOR_HEAL', c);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.skipDay();
    const r = submitNightAction(g.state, { actorId: doc, kind: 'DOCTOR_HEAL', targetIds: [c], now: 0 });
    expect(r.ok).toBe(false);
  });

  it('Bloklangan bir martalik qobiliyat zaryadni sarflamaydi (Q1)', () => {
    const g = new TestGame(['DON', 'BLOCKER', 'ENGINEER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('BLOCKER'), 'BLOCKER_BLOCK', g.id('ENGINEER'));
    g.act(g.id('ENGINEER'), 'ENGINEER_INSTALL', g.id('CITIZEN'));
    g.endNight();
    expect(g.p(g.id('ENGINEER')).ability.charges['install']).toBe(1);
  });

  it('Muhandis: hujum qaytarilgani haqida hisobot', () => {
    const g = new TestGame(['DON', 'ENGINEER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const c = g.id('CITIZEN');
    g.act(g.id('ENGINEER'), 'ENGINEER_INSTALL', c);
    g.mafia(g.id('DON'), c);
    const ev = g.endNight();
    expect(g.p(c).status).toBe('ALIVE');
    expect(privateTo(ev, 'ENGINEER_RESULT', g.id('ENGINEER'))[0]!.triggered).toBe(true);
    expect(g.p(g.id('ENGINEER')).ability.charges['install']).toBe(0);
  });

  it('Mafia Qo‘riqchisi Donni Manyakdan qutqaradi', () => {
    const g = new TestGame(['DON', 'MAFIA_GUARD', 'SERIAL_KILLER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('MAFIA_GUARD'), 'MAFIA_GUARD_PROTECT', g.id('DON'));
    g.act(g.id('SERIAL_KILLER'), 'SERIAL_KILLER_KILL', g.id('DON'));
    g.mafia(g.id('DON'), null);
    g.endNight();
    expect(g.p(g.id('DON')).status).toBe('ALIVE');
  });

  it('Qasoskor o‘ldirilsa belgilangan nishonga javob hujumi', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'AVENGER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('AVENGER'), 'AVENGER_MARK', g.id('DON'));
    g.mafia(g.id('DON'), g.id('AVENGER'));
    g.mafia(g.id('MAFIOSO'), g.id('AVENGER'));
    g.endNight();
    expect(g.p(g.id('AVENGER')).status).toBe('DEAD');
    expect(g.p(g.id('DON')).status).toBe('DEAD');
    expect(g.p(g.id('DON')).death?.cause).toBe('AVENGER');
  });

  it('Detektiv ijrochi tashrifini, Kuzatuvchi tashrif buyurganlarni ko‘radi', () => {
    const g = new TestGame(['DON', 'DETECTIVE', 'WATCHER', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const c = g.id('CITIZEN');
    g.mafia(g.id('DON'), c);
    g.act(g.id('DOCTOR'), 'DOCTOR_HEAL', c);
    g.act(g.id('DETECTIVE'), 'DETECTIVE_TRACK', g.id('DON'));
    g.act(g.id('WATCHER'), 'WATCHER_WATCH', c);
    const ev = g.endNight();
    expect(privateTo(ev, 'TRACK_RESULT', g.id('DETECTIVE'))[0]!.visitedIds).toEqual([c]);
    expect(privateTo(ev, 'WATCH_RESULT', g.id('WATCHER'))[0]!.visitorIds.sort()).toEqual([g.id('DON'), g.id('DOCTOR')].sort());
  });

  it('Jurnalist: mustaqil rollar alohida fraksiya', () => {
    const g = new TestGame(['DON', 'JOURNALIST', 'JESTER', 'THIEF', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('JOURNALIST'), 'JOURNALIST_COMPARE', g.id('JESTER'), g.id('THIEF'));
    g.mafia(g.id('DON'), null);
    const ev = g.endNight();
    expect(privateTo(ev, 'COMPARE_RESULT', g.id('JOURNALIST'))[0]!.same).toBe(false);
  });

  it('Konsilyeri aniq rolni ko‘radi va natija Mafia jamoasiga boradi', () => {
    const g = new TestGame(['DON', 'CONSIGLIERE', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('CONSIGLIERE'), 'CONSIGLIERE_CHECK', g.id('DOCTOR'));
    g.mafia(g.id('DON'), null);
    const ev = g.endNight();
    const r = eventsOf(ev, 'ROLE_RESULT')[0]!;
    expect(r.role).toBe('DOCTOR');
    expect(r.audience.kind).toBe('mafia');
  });

  it('Mafia ovozida tenglik: Don tanlovi hal qiladi', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const [a, b] = [g.id('CITIZEN', 0), g.id('CITIZEN', 1)];
    g.mafia(g.id('DON'), a);
    g.mafia(g.id('MAFIOSO'), b);
    g.endNight();
    expect(g.p(a).status).toBe('DEAD');
    expect(g.p(b).status).toBe('ALIVE');
  });

  it('Amur tanlamasa server tasodifiy bog‘laydi', () => {
    const g = new TestGame(['DON', 'CUPID', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    expect(g.state.links.lovers).not.toBeNull();
    expect(g.state.links.lovers).not.toContain(g.id('CUPID'));
  });

  it('Ixtiyoriy chiqish yurak ezilishini ishga tushirmaydi (§32.2)', () => {
    const g = new TestGame(['DON', 'CUPID', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const [a, b] = [g.id('CITIZEN', 0), g.id('CITIZEN', 1)];
    g.act(g.id('CUPID'), 'CUPID_LINK', a, b);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.leave(a);
    expect(g.p(a).status).toBe('LEFT');
    expect(g.p(b).status).toBe('ALIVE');
  });

  it('Mafia o‘z jamoadoshini nishon qila olmaydi', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    expect(() => g.mafia(g.id('DON'), g.id('MAFIOSO'))).toThrow(/INVALID_TARGET/);
  });

  it('O‘lgan o‘yinchi harakat qila olmaydi', () => {
    const g = new TestGame(['DON', 'COMMISSAR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('COMMISSAR'));
    g.endNight();
    g.skipDay();
    const r = submitNightAction(g.state, { actorId: g.id('COMMISSAR'), kind: 'COMMISSAR_CHECK', targetIds: [g.id('DON')], now: 0 });
    expect(r.ok).toBe(false);
  });

  it('Hamma harakat qilsa tun erta tugashi mumkin', () => {
    const g = new TestGame(['DON', 'DOCTOR', 'CITIZEN', 'CITIZEN']);
    expect(canEndPhaseEarly(g.state)).toBe(false);
    g.mafia(g.id('DON'), g.id('CITIZEN'));
    g.skip(g.id('DOCTOR'));
    expect(canEndPhaseEarly(g.state)).toBe(true);
  });
});

describe('createGame', () => {
  it('4 dan kam o‘yinchi bilan boshlanmaydi', () => {
    const r = createGame({
      id: 'x',
      mode: 'CLASSIC',
      players: [1, 2, 3].map((i) => ({ id: `${i}`, name: `${i}` })),
      now: 0,
      rng: seededRng(1),
    });
    expect(r.ok).toBe(false);
  });

  it('rollar yuboriladi, Mafia jamoadoshlarini biladi', () => {
    const r = createGame({
      id: 'x',
      mode: 'CLASSIC',
      players: Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, name: `U${i}` })),
      now: 0,
      rng: seededRng(3),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eventsOf(r.events, 'ROLE_ASSIGNED')).toHaveLength(8);
    const mafia = r.state.players.filter((p) => p.faction === 'MAFIA');
    const teams = eventsOf(r.events, 'MAFIA_TEAM');
    expect(teams).toHaveLength(mafia.length);
    for (const t of teams) expect(t.members.map((m) => m.playerId).sort()).toEqual(mafia.map((m) => m.id).sort());
  });
});
