import {describe,it,expect} from 'vitest';
import {visualBlob} from '../visuals';
import {TgError} from '../telegram';
import {World,privateText,groupText,callback,GROUP} from './harness';
describe('V2 optional phase animations',()=>{
 it('generates four distinct bounded GIFs',async()=>{
  const bytes:string[]=[];
  for(const key of ['v2_night','v2_dawn','v2_vote','v2_end']){
   const blob=visualBlob(key)!;
   expect(blob.type).toBe('image/gif');expect(blob.size).toBeLessThan(200000);
   const data=new Uint8Array(await blob.arrayBuffer());
   expect(new TextDecoder().decode(data.slice(0,6))).toBe('GIF89a');
   expect(data.at(-1)).toBe(0x3b);
   bytes.push(Buffer.from(data).toString('base64'));
  }
  expect(new Set(bytes).size).toBe(4);
 });
 it('sends only group phase media, after required messages, and continues after media failure',async()=>{
  const w=new World({v2Preview:true,v2Ledger:true,visuals:true});
  const call=w.tg.call.bind(w.tg);
  w.tg.call=async <T>(method:string,params?:Record<string,unknown>):Promise<T>=>{
   const result=await call<T>(method,params);
   if(method==='sendAnimation'&&params?.chat_id===GROUP)throw new TgError(429,'media rate limited',3);
   return result;
  };
  for(const id of [1,2,3,4])await w.send(privateText(id,'/start'));
  await w.send(groupText(1,'/game_v2classic'));
  const core=await w.loaded(GROUP),n=core.data.game!.number;
  for(const id of [2,3,4])await w.send(callback(id,'l:j:'+n,GROUP));
  const start=w.tg.calls.length;
  await w.send(groupText(1,'/startgame'));
  const calls=w.tg.calls.slice(start);
  const media=calls.findIndex(c=>c.method==='sendAnimation'&&c.params.chat_id===GROUP);
  expect(media).toBeGreaterThan(0);
  expect(calls.slice(0,media).some(c=>c.method==='sendMessage'&&c.params.chat_id===GROUP&&String(c.params.text).includes('Tun boshlandi'))).toBe(true);
  expect(calls.slice(0,media).filter(c=>c.method==='sendMessage'&&Number(c.params.chat_id)>0&&String(c.params.text).includes('Harakatingizni tanlang.'))).toHaveLength(3);
  expect(calls.filter(c=>c.method==='sendAnimation'&&Number(c.params.chat_id)>0)).toHaveLength(0);
  expect(core.data.outbox).toHaveLength(0);
  await w.advance(30001);
  expect(core.data.game?.v2Session?.state.phase).toBe('DAWN');
  expect(w.tg.texts(GROUP).some(t=>t.includes('Tong otdi'))).toBe(true);
  expect(w.tg.calls.slice(start).filter(c=>c.method==='sendAnimation'&&c.params.chat_id===GROUP)).toHaveLength(2);
 });
});
