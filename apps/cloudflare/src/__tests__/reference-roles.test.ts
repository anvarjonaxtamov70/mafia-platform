import {describe,it,expect} from 'vitest';
import {REFERENCE_ROLES,referenceRolesView,referenceRoleDetail,decode} from '@mafia/bot-core';
import {World,privateText,callback,GROUP} from './harness';
describe('reference catalogue draft',()=>{
  it('exact order, 27 unique entries, 13 two-column rows and one final row, bounded callbacks',()=>{
    const ids='citizen don mafia manyak komissar doktor serjant daydi frozen advokat suidsid killer kamikaze grench minior shpion zombi kimyogar tentak buqalamun sotuvchi krampous omadli klaus sehrgar mergan janob'.split(' ');
    expect(REFERENCE_ROLES.map(r=>r.id)).toEqual(ids);
    const view=referenceRolesView();
    expect(view.keyboard).toHaveLength(14);
    for(const row of view.keyboard){
      expect(row).toHaveLength(row===view.keyboard.at(-1)?1:2);
      for(const b of row){
        if(!('callback_data' in b))throw Error('unexpected link');
        expect(Buffer.byteLength(b.callback_data,'utf8')).toBeLessThanOrEqual(64);
        expect(decode(b.callback_data)).toMatchObject({t:'menu'});
        const d=referenceRoleDetail(b.callback_data.slice(2))!;
        expect(d.text.length).toBeGreaterThan(0);
        expect(d.alert).toBe(d.text.length<=200);
      }
    }
  });
  it('short descriptions are private alerts, long descriptions private messages; stale/group requests cannot send details',async()=>{
    const w=new World();
    await w.send(privateText(2,'/roles'));
    const msg=w.tg.sent(2).at(-1)!;
    expect(msg.params['text']).toBe("Rollar ro'yhati:");
    for(const role of REFERENCE_ROLES){
      await w.advance(3100);
      const section='ref_'+role.id;
      const detail=referenceRoleDetail(section)!;
      const before=w.tg.calls.length;
      await w.send(callback(2,'m:'+section));
      const calls=w.tg.calls.slice(before);
      if(detail.alert)expect(calls.some(c=>c.method==='answerCallbackQuery'&&c.params['show_alert']===true)).toBe(true);
      else expect(calls.some(c=>c.method==='sendMessage'&&c.params['chat_id']===2)).toBe(true);
      expect(calls.some(c=>c.method==='editMessageText')).toBe(false);
    }
    await w.advance(3100);
    const before=w.tg.calls.length;
    await w.send(callback(2,'m:ref_krampous',GROUP));
    await w.send(callback(2,'m:ref_invalid'));
    expect(w.tg.calls.slice(before).some(c=>c.method==='sendMessage')).toBe(false);
  });
});
