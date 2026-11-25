import {describe,expect,it} from 'vitest';
import {World,privateText,callback,GROUP} from './harness';
import {createGame,heroAttack,seededRng} from '@mafia/game-engine';
import {shopHomeView,mainMenu} from '@mafia/bot-core';
describe('single hero and shop',()=>{
  it('currency purchase placeholders render a valid keyboard and do not charge',async()=>{
    const w=new World();
    await w.send(privateText(2,'/start'));
    for(const section of ['buy_dollars','buy_diamonds']){
      await w.send(callback(2,'m:'+section));
      const edit=w.tg.calls.filter(c=>c.method==='editMessageText').at(-1);
      expect(edit?.params['text']).toContain('hali tasdiqlanmagan');
      const markup=edit?.params['reply_markup'] as {inline_keyboard: unknown[][]};
      expect(markup.inline_keyboard).toHaveLength(1);
      expect(Array.isArray(markup.inline_keyboard[0])).toBe(true);
      expect(markup.inline_keyboard[0]).toEqual([expect.objectContaining({callback_data:'m:home'})]);
    }
    expect(w.registryCore.eco.coins(2)).toBe(0);
    expect(w.registryCore.eco.diamonds(2)).toBe(0);
    expect(w.tg.calls.some(c=>c.method==='sendInvoice')).toBe(false);
  });
  it('shop has only supported products and no cosmetic or inventory entry',()=>{
    const data=JSON.stringify(shopHomeView(100,20).keyboard);
    for(const code of ['SHIELD','FAKE_DOC','VOTE_SHIELD','HERO_SHIELD','m:hero','m:vip'])expect(data).toContain(code);
    for(const code of ['FRAME','TITLE','inventory','KNIFE','MARKET'])expect(data).not.toContain(code);
    expect(JSON.stringify(mainMenu(true,true,true))).not.toContain('m:heroes');
  });
  it('100 diamonds once, owner level isolated, 2 diamond defense, retired cosmetic sales blocked',async()=>{
    const w=new World({ownerBenefits:true});w.admins.add(6);
    for(const id of [1,2,6])await w.send(privateText(id,'/start'));
    const r=w.registryCore,e=r.eco;
    expect(e.buyHero(2,'x').ok).toBe(false);
    e.creditDiamonds(2,102,'TEST','seed');
    expect(e.buyHero(2,'a').ok).toBe(true);
    expect(e.buyHero(2,'b').ok).toBe(true);
    expect(e.diamonds(2)).toBe(2);
    expect(e.buy(2,'HERO_SHIELD','c').ok).toBe(true);
    expect(e.diamonds(2)).toBe(0);
    expect(e.toggleArm(2,'HERO_SHIELD')).toBe(true);
    const got=e.reserveArcade(99,[1,2,6]);
    expect(got['2']).toMatchObject({heroShot:true,heroShield:true});
    e.settleArcade(99,{'2':['HERO_SHIELD']});
    expect(e.inventory(2).items.find(i=>i.code==='HERO_SHIELD')?.qty).toBe(0);
    expect(e.hasHero(2)).toBe(true);
    expect(r.setOwnHeroLevel(2,1000)).toBe(false);
    expect(r.setOwnHeroLevel(1,1000)).toBe(true);
    expect(r.singleHero(1)).toMatchObject({owned:true,level:1000,totalXp:0});
    expect(r.singleHero(6).owned).toBe(true);
    expect(r.heroTop()).toHaveLength(0);
    expect(e.buy(1,'BRONZE','retired').ok).toBe(false);
    await w.send(callback(2,'e:herook:',GROUP));
    expect(e.diamonds(2)).toBe(0);
  });
  it('one shot, one shield, private actor validation, expired phase, ranked isolation',()=>{
    const make=(mode:'ARCADE'|'CLASSIC')=>{
      const r=createGame({id:'hero',mode,players:['1','2','3','4','5'].map(id=>({id,name:id})),fixedRoles:['DON','COMMISSAR','DOCTOR','CITIZEN','CITIZEN'],items:{'1':{heroShot:true},'2':{heroShield:true},'3':{heroShot:true}},now:1,rng:seededRng(1)});
      if(!r.ok)throw Error(r.error);
      r.state.phase='DAY_DISCUSSION';r.state.dayNumber=1;return r.state;
    };
    const s=make('ARCADE'),seq=s.phaseSeq,rng=seededRng(2);
    expect(heroAttack(s,'1','1',2,rng,seq).ok).toBe(false);
    expect(heroAttack(s,'4','2',2,rng,seq).ok).toBe(false);
    expect(heroAttack(s,'1','2',2,rng,seq+1).ok).toBe(false);
    const a=heroAttack(s,'1','2',2,rng,seq);
    if(!a.ok)throw Error(a.error);
    expect(a.state.players[1]?.status).toBe('ALIVE');
    expect(a.state.players[1]?.items.heroShield).toBe(false);
    expect(heroAttack(a.state,'1','2',2,rng,seq).ok).toBe(false);
    const b=heroAttack(a.state,'3','2',2,rng,seq);
    if(!b.ok)throw Error(b.error);
    expect(b.state.players[1]?.death?.cause).toBe('HERO');
    expect(heroAttack(s,'1','2',s.phaseEndsAt!,rng,seq).ok).toBe(false);
    expect(heroAttack(make('CLASSIC'),'1','2',2,rng,seq).ok).toBe(false);
  });
});


describe('Compact home menu v10', () => {
  it('shows only nine requested home buttons in six rows', () => {
    const expected = [['m:play'], ['m:profile', 'm:hero'], ['m:shop', 'm:vip'], ['m:invite'], ['m:characters', 'm:settings'], ['m:help']];
    for (const competition of [false, true]) for (const visuals of [false, true]) {
      expect(mainMenu(competition, visuals, true).map(row => row.map(b => 'callback_data' in b ? b.callback_data : null))).toEqual(expected);
    }
  });
  it('start and back return the compact home without obsolete account level text', async () => {
    const w = new World();
    await w.send(privateText(2, '/start'));
    const message = w.tg.calls.filter(c => c.method === 'sendMessage' && c.params['chat_id'] === 2).at(-1);
    const markup = message?.params['reply_markup'] as { inline_keyboard: { callback_data: string }[][] };
    expect(markup.inline_keyboard.flat().map(b => b.callback_data)).toEqual(['m:play','m:profile','m:hero','m:shop','m:vip','m:invite','m:characters','m:settings','m:help']);
    expect(message?.params['text']).not.toContain('Darajangizni');
    await w.send(callback(2, 'm:home'));
    const edit = w.tg.calls.filter(c => c.method === 'editMessageText').at(-1);
    expect(edit?.params['reply_markup']).toEqual(message?.params['reply_markup']);
  });
});
