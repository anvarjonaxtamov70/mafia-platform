import {describe,it,expect} from 'vitest';
import {World,privateText,callback,GROUP} from './harness';
describe('private v2 hero test shop',()=>{
 it('disabled by default, quote is private and cannot charge twice',async()=>{
  const normal=new World();await normal.send(privateText(2,'/start'));await normal.send(privateText(2,'/herov2'));
  expect(normal.tg.texts(2).at(-1)).toContain('mavjud emas');
  const w=new World({v2Ledger:true});for(const id of [2,3])await w.send(privateText(id,'/start'));
  const e=w.registryCore.eco;e.creditDiamonds(2,200,'TEST','d2');
  await w.send(privateText(2,'/herov2'));expect(w.tg.texts(2).at(-1)).toContain('90 💎');
  await w.send(callback(2,'hv2:q:BUY',GROUP));expect(e.diamonds(2)).toBe(200);
  await w.send(callback(2,'hv2:q:BUY'));
  const last=w.tg.calls.filter(c=>c.method==='editMessageText').at(-1)!;
  const markup=last.params.reply_markup as {inline_keyboard:{callback_data:string}[][]};
  const code=markup.inline_keyboard[0]![0]!.callback_data;
  expect(code).toMatch(/^hv2:c:/);
  await w.send(callback(3,code));expect(e.diamonds(2)).toBe(200);
  await w.send(callback(2,code));await w.send(callback(2,code));
  expect(e.diamonds(2)).toBe(110);
  expect(w.registryCore.heroV2.view(2)).toMatchObject({level:1,charges:10,defense:8});
  await w.send(privateText(2,'/herov2'));expect(w.tg.texts(2).at(-1)).toContain('45 HP');
 });
});
