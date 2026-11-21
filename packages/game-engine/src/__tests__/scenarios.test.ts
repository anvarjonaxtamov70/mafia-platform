/**
 * §15 — rollar o'rtasidagi 22 ta muhim to'qnashuv. Har biri alohida test.
 */
import { describe, expect, it } from 'vitest';
import { submitNightAction } from '../engine';
import { voteWeight } from '../engine';
import { eventsOf, privateTo, TestGame } from './helpers';

describe('§15 rollar to‘qnashuvlari', () => {
  it('V1: Mafia Komissarga hujum qiladi, Doktor davolaydi → Komissar tirik', () => {
    const g = new TestGame(['DON', 'COMMISSAR', 'DOCTOR', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('COMMISSAR'));
    g.act(g.id('DOCTOR'), 'DOCTOR_HEAL', g.id('COMMISSAR'));
    const ev = g.endNight();
    expect(g.p(g.id('COMMISSAR')).status).toBe('ALIVE');
    const dawn = eventsOf(ev, 'DAWN')[0]!;
    expect(dawn.deaths).toEqual([]);
    expect(dawn.savedCount).toBe(1);
  });

  it('V2: Bloklovchi Doktorni bloklasa, himoya ishlamaydi → Komissar halok', () => {
    const g = new TestGame(['DON', 'BLOCKER', 'COMMISSAR', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('COMMISSAR'));
    g.mafia(g.id('BLOCKER'), g.id('COMMISSAR'));
    g.act(g.id('BLOCKER'), 'BLOCKER_BLOCK', g.id('DOCTOR'));
    g.act(g.id('DOCTOR'), 'DOCTOR_HEAL', g.id('COMMISSAR'));
    const ev = g.endNight();
    expect(g.p(g.id('COMMISSAR')).status).toBe('DEAD');
    expect(privateTo(ev, 'ACTION_FAILED', g.id('DOCTOR'))).toHaveLength(1);
  });

  it('V3: Advokat Donni yashiradi → Komissar SHAHAR ko‘radi', () => {
    const g = new TestGame(['DON', 'LAWYER', 'COMMISSAR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('LAWYER'), 'LAWYER_MASK', g.id('DON'));
    g.act(g.id('COMMISSAR'), 'COMMISSAR_CHECK', g.id('DON'));
    const ev = g.endNight();
    expect(privateTo(ev, 'CHECK_RESULT', g.id('COMMISSAR'))[0]!.faction).toBe('CITY');
  });

  it('V4: Advokat + Ruhoniy → Komissar MAFIA ko‘radi', () => {
    const g = new TestGame(['DON', 'LAWYER', 'COMMISSAR', 'PRIEST', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('LAWYER'), 'LAWYER_MASK', g.id('DON'));
    g.act(g.id('PRIEST'), 'PRIEST_CLEANSE', g.id('DON'));
    g.act(g.id('COMMISSAR'), 'COMMISSAR_CHECK', g.id('DON'));
    const ev = g.endNight();
    expect(privateTo(ev, 'CHECK_RESULT', g.id('COMMISSAR'))[0]!.faction).toBe('MAFIA');
  });

  it('V5: Soxtakor Fuqaroga soxta dalil qo‘yadi → MAFIA natijasi', () => {
    const g = new TestGame(['DON', 'FORGER', 'COMMISSAR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('FORGER'), 'FORGER_FRAME', g.id('CITIZEN'));
    g.act(g.id('COMMISSAR'), 'COMMISSAR_CHECK', g.id('CITIZEN'));
    const ev = g.endNight();
    expect(privateTo(ev, 'CHECK_RESULT', g.id('COMMISSAR'))[0]!.faction).toBe('MAFIA');
  });

  it('V6: Advokat va Soxtakor bitta odamga → avval niqob, keyin Soxtakor; Ruhoniy haqiqatni tiklaydi', () => {
    const roles = ['DON', 'LAWYER', 'FORGER', 'COMMISSAR', 'PRIEST', 'CITIZEN', 'CITIZEN', 'CITIZEN'] as const;
    const g = new TestGame([...roles]);
    g.act(g.id('LAWYER'), 'LAWYER_MASK', g.id('LAWYER'));
    g.act(g.id('FORGER'), 'FORGER_FRAME', g.id('LAWYER'));
    g.act(g.id('COMMISSAR'), 'COMMISSAR_CHECK', g.id('LAWYER'));
    let ev = g.endNight();
    // Q7: Soxtakor oxirgi qatlam → MAFIA
    expect(privateTo(ev, 'CHECK_RESULT', g.id('COMMISSAR'))[0]!.faction).toBe('MAFIA');

    const g2 = new TestGame([...roles]);
    g2.act(g2.id('LAWYER'), 'LAWYER_MASK', g2.id('DON'));
    g2.act(g2.id('FORGER'), 'FORGER_FRAME', g2.id('DON'));
    g2.act(g2.id('PRIEST'), 'PRIEST_CLEANSE', g2.id('DON'));
    g2.act(g2.id('COMMISSAR'), 'COMMISSAR_CHECK', g2.id('DON'));
    ev = g2.endNight();
    expect(privateTo(ev, 'CHECK_RESULT', g2.id('COMMISSAR'))[0]!.faction).toBe('MAFIA');
  });

  it('V7: Qo‘riqchi Doktorni himoyalaydi, Manyak Doktorga hujum → Doktor tirik, Qo‘riqchi halok', () => {
    const g = new TestGame(['DON', 'SERIAL_KILLER', 'BODYGUARD', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.act(g.id('BODYGUARD'), 'BODYGUARD_GUARD', g.id('DOCTOR'));
    g.act(g.id('DOCTOR'), 'DOCTOR_HEAL', g.id('CITIZEN'));
    g.act(g.id('SERIAL_KILLER'), 'SERIAL_KILLER_KILL', g.id('DOCTOR'));
    g.endNight();
    expect(g.p(g.id('DOCTOR')).status).toBe('ALIVE');
    expect(g.p(g.id('BODYGUARD')).status).toBe('DEAD');
  });

  it('V8: Feniks birinchi hujumda qayta tiriladi', () => {
    const g = new TestGame(['DON', 'PHOENIX', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('PHOENIX'));
    const ev = g.endNight();
    expect(g.p(g.id('PHOENIX')).status).toBe('ALIVE');
    expect(g.p(g.id('PHOENIX')).ability.flags['phoenixUsed']).toBe(true);
    const dawn = eventsOf(ev, 'DAWN')[0]!;
    expect(dawn.revivedCount).toBe(1);
    // Q16: standartda shaxs yashirin
    expect(dawn.revivedIds).toEqual([]);
  });

  it('V9: Feniks ikkinchi hujumda halok bo‘ladi', () => {
    const g = new TestGame(['DON', 'PHOENIX', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('PHOENIX'));
    g.endNight();
    g.skipDay();
    g.mafia(g.id('DON'), g.id('PHOENIX'));
    g.endNight();
    expect(g.p(g.id('PHOENIX')).status).toBe('DEAD');
  });

  it('V10: Sudya chiqarishni bekor qiladi, nomzod Masxaraboz → shaxsiy g‘alaba yo‘q', () => {
    const g = new TestGame(['DON', 'JUDGE', 'JESTER', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    g.voteOut(g.id('JESTER'));
    expect(g.state.phase).toBe('DAY_VERDICT');
    const ev = g.veto(g.id('JUDGE'));
    expect(eventsOf(ev, 'JUDGE_VETO')).toHaveLength(1);
    expect(g.p(g.id('JESTER')).status).toBe('ALIVE');
    expect(eventsOf(ev, 'PERSONAL_WIN')).toHaveLength(0);
    expect(g.state.phase).toBe('NIGHT');
  });

  it('V11: Masxaraboz ovoz bilan chiqariladi → shaxsiy g‘alaba va chiqish', () => {
    const g = new TestGame(['DON', 'JESTER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    const ev = g.voteOut(g.id('JESTER'));
    expect(g.p(g.id('JESTER')).status).toBe('PERSONAL_WIN_EXIT');
    expect(eventsOf(ev, 'PERSONAL_WIN')[0]!.role).toBe('JESTER');
    expect(g.state.status).toBe('RUNNING');
  });

  it('V12: Sherif va Bloklovchi bir-birini bloklaydi → ikkala blok qo‘llanadi', () => {
    const g = new TestGame(['MAFIOSO', 'BLOCKER', 'SHERIFF', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('SHERIFF'), 'SHERIFF_ARREST', g.id('BLOCKER'));
    g.act(g.id('BLOCKER'), 'BLOCKER_BLOCK', g.id('SHERIFF'));
    g.mafia(g.id('MAFIOSO'), null);
    const ev = g.endNight();
    // Sherif bloklangan → hisobot yo'q (Q2)
    expect(privateTo(ev, 'SHERIFF_RESULT', g.id('SHERIFF'))).toHaveLength(0);
  });

  it('V12b: Sherif hisobotida nishon harakat qilgani ko‘rsatiladi', () => {
    const g = new TestGame(['DON', 'SHERIFF', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('SHERIFF'), 'SHERIFF_ARREST', g.id('DOCTOR'));
    g.act(g.id('DOCTOR'), 'DOCTOR_HEAL', g.id('CITIZEN'));
    g.mafia(g.id('DON'), g.id('CITIZEN'));
    const ev = g.endNight();
    expect(privateTo(ev, 'SHERIFF_RESULT', g.id('SHERIFF'))[0]!.acted).toBe(true);
    // Doktor bloklandi → Fuqaro halok
    expect(g.p(g.id('CITIZEN')).status).toBe('DEAD');
  });

  it('V13: Komissar hujumga uchrab o‘ladi → tekshiruv hisoblanadi, natija yuborilmaydi', () => {
    const g = new TestGame(['DON', 'COMMISSAR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), g.id('COMMISSAR'));
    g.act(g.id('COMMISSAR'), 'COMMISSAR_CHECK', g.id('DON'));
    const ev = g.endNight();
    expect(g.p(g.id('COMMISSAR')).status).toBe('DEAD');
    expect(privateTo(ev, 'CHECK_RESULT', g.id('COMMISSAR'))).toHaveLength(0);
  });

  it('V14: Oshiqlardan biri halok → ikkinchisi yurak ezilishidan halok', () => {
    const g = new TestGame(['DON', 'CUPID', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const [a, b] = [g.id('CITIZEN', 0), g.id('CITIZEN', 1)];
    g.act(g.id('CUPID'), 'CUPID_LINK', a, b);
    g.mafia(g.id('DON'), a);
    const ev = g.endNight();
    expect(g.p(a).status).toBe('DEAD');
    expect(g.p(b).status).toBe('DEAD');
    expect(g.p(b).death?.cause).toBe('HEARTBREAK');
    expect(eventsOf(ev, 'DAWN')[0]!.deaths.map((d) => d.playerId).sort()).toEqual([a, b].sort());
  });

  it('V15: Ovchi nishoni va Ovchi bir tunda halok → shaxsiy g‘alaba yo‘q', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'HUNTER', 'SERIAL_KILLER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const target = g.id('CITIZEN');
    g.state.links.hunterTargets[g.id('HUNTER')] = target;
    g.mafia(g.id('DON'), target);
    g.mafia(g.id('MAFIOSO'), target);
    g.act(g.id('SERIAL_KILLER'), 'SERIAL_KILLER_KILL', g.id('HUNTER'));
    const ev = g.endNight();
    expect(g.p(target).status).toBe('DEAD');
    expect(g.p(g.id('HUNTER')).status).toBe('DEAD');
    expect(eventsOf(ev, 'PERSONAL_WIN')).toHaveLength(0);
  });

  it('V15b: Ovchi nishoni halok, Ovchi tirik → shaxsiy g‘alaba', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'HUNTER', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const target = g.id('CITIZEN');
    g.state.links.hunterTargets[g.id('HUNTER')] = target;
    g.mafia(g.id('DON'), target);
    g.mafia(g.id('MAFIOSO'), target);
    const ev = g.endNight();
    expect(eventsOf(ev, 'PERSONAL_WIN')[0]!.role).toBe('HUNTER');
    expect(g.p(g.id('HUNTER')).status).toBe('PERSONAL_WIN_EXIT');
  });

  it('V16: O‘g‘ri Merni tanlaydi → Mer ovozi 2 dan 1 ga tushadi', () => {
    const g = new TestGame(['DON', 'THIEF', 'MAYOR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('THIEF'), 'THIEF_STEAL', g.id('MAYOR'));
    g.mafia(g.id('DON'), null);
    const ev = g.endNight();
    expect(privateTo(ev, 'VOTE_WEAKENED', g.id('MAYOR'))).toHaveLength(1);
    g.revealMayor(g.id('MAYOR'));
    expect(voteWeight(g.state, g.p(g.id('MAYOR')))).toBe(1);
  });

  it('V17: O‘g‘ri Fuqaroni tanlaydi → Fuqaro ovozi 0', () => {
    const g = new TestGame(['DON', 'THIEF', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.act(g.id('THIEF'), 'THIEF_STEAL', g.id('CITIZEN'));
    g.mafia(g.id('DON'), null);
    g.endNight();
    expect(voteWeight(g.state, g.p(g.id('CITIZEN')))).toBe(0);
    // Keyingi kunduzda tiklanadi
    g.skipDay();
    g.mafia(g.id('DON'), null);
    g.endNight();
    expect(voteWeight(g.state, g.p(g.id('CITIZEN')))).toBe(1);
  });

  it('V18: Mafia va Manyak bitta odamga, Doktor bitta himoya → baribir halok', () => {
    const g = new TestGame(['DON', 'SERIAL_KILLER', 'DOCTOR', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const t = g.id('CITIZEN');
    g.mafia(g.id('DON'), t);
    g.act(g.id('SERIAL_KILLER'), 'SERIAL_KILLER_KILL', t);
    g.act(g.id('DOCTOR'), 'DOCTOR_HEAL', t);
    const ev = g.endNight();
    expect(g.p(t).status).toBe('DEAD');
    expect(eventsOf(ev, 'DAWN')[0]!.savedCount).toBe(1);
  });

  it('V19: Egizaklardan biri kunduzda chiqariladi → ikkinchisi keyingi kunduzda 2 ovoz', () => {
    const g = new TestGame(['DON', 'TWIN', 'TWIN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.endNight();
    const [t1, t2] = [g.id('TWIN', 0), g.id('TWIN', 1)];
    const ev = g.voteOut(t1);
    expect(g.p(t1).status).toBe('DEAD');
    expect(privateTo(ev, 'TWIN_BONUS', t2)).toHaveLength(1);
    g.mafia(g.id('DON'), null);
    g.endNight();
    expect(voteWeight(g.state, g.p(t2))).toBe(2);
    g.skipDay();
    g.mafia(g.id('DON'), null);
    g.endNight();
    // Bonus bir marta
    expect(voteWeight(g.state, g.p(t2))).toBe(1);
  });

  it('V20: Don halok bo‘lgan → hujum boshqa Mafia a’zosiga o‘tadi', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    g.mafia(g.id('DON'), null);
    g.mafia(g.id('MAFIOSO'), null);
    g.endNight();
    g.voteOut(g.id('DON'));
    expect(g.p(g.id('DON')).status).toBe('DEAD');
    const victim = g.id('CITIZEN', 2);
    g.mafia(g.id('MAFIOSO'), victim);
    g.endNight();
    expect(g.p(victim).status).toBe('DEAD');
  });

  it('V20b: Don bloklangan → Mafioso ijro etadi', () => {
    const g = new TestGame(['DON', 'MAFIOSO', 'SHERIFF', 'CITIZEN', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const victim = g.id('CITIZEN');
    g.act(g.id('SHERIFF'), 'SHERIFF_ARREST', g.id('DON'));
    g.mafia(g.id('DON'), victim);
    g.mafia(g.id('MAFIOSO'), victim);
    g.endNight();
    expect(g.p(victim).status).toBe('DEAD');
  });

  it('V21: Feniks tirilishi yurak ezilishi o‘limini bekor qilmaydi', () => {
    const g = new TestGame(['DON', 'CUPID', 'PHOENIX', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const lover = g.id('CITIZEN');
    g.act(g.id('CUPID'), 'CUPID_LINK', g.id('PHOENIX'), lover);
    g.mafia(g.id('DON'), lover);
    g.endNight();
    expect(g.p(lover).status).toBe('DEAD');
    expect(g.p(g.id('PHOENIX')).status).toBe('DEAD');
    expect(g.p(g.id('PHOENIX')).death?.cause).toBe('HEARTBREAK');
    expect(g.p(g.id('PHOENIX')).ability.flags['phoenixUsed']).toBeFalsy();
  });

  it('V21b: Feniks tirilsa, sherigi tirik qoladi (Q15)', () => {
    const g = new TestGame(['DON', 'CUPID', 'PHOENIX', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const lover = g.id('CITIZEN');
    g.act(g.id('CUPID'), 'CUPID_LINK', g.id('PHOENIX'), lover);
    g.mafia(g.id('DON'), g.id('PHOENIX'));
    g.endNight();
    expect(g.p(g.id('PHOENIX')).status).toBe('ALIVE');
    expect(g.p(lover).status).toBe('ALIVE');
  });

  it('V22: Eskirgan tugma → harakat rad etiladi', () => {
    const g = new TestGame(['DON', 'COMMISSAR', 'CITIZEN', 'CITIZEN', 'CITIZEN']);
    const oldSeq = g.state.phaseSeq;
    g.mafia(g.id('DON'), null);
    g.endNight();
    const r = submitNightAction(g.state, {
      actorId: g.id('COMMISSAR'),
      kind: 'COMMISSAR_CHECK',
      targetIds: [g.id('DON')],
      now: g.now,
      phaseSeq: oldSeq,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('STALE_PHASE');
  });
});
