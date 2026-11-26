/** Draft v2 persistence. Uses existing transaction/ledger; not exposed to Telegram
 * until v2 rooms can atomically snapshot, reserve and settle their hero shots.
 */
import {HERO_V2_PRICE,HERO_V2_MAX_CHARGES,HERO_V2_RENAME_PRICE,HERO_V2_XP_PACKS,heroV2Level,heroV2Stats,heroV2Threshold,heroV2ShotPoints,heroV2Hit} from '@mafia/bot-core';
import type {Sql} from './sql';
import type {EconomyCore} from './economy-core';
type HeroRow={telegram_id:number;name:string;points:number;defense:number;charges:number};
export type HeroV2Purchase='BUY'|'XP500'|'XP1000'|'RESTORE'|'RELOAD'|'RENAME';
export type HeroV2BuyResult='OK'|'UNAVAILABLE'|'INSUFFICIENT'|'FULL'|'INVALID'|'CONFLICT';
export class HeroV2Core {
 constructor(private readonly sql:Sql,private readonly eco:EconomyCore,private readonly clock:()=>number){}
 migrate(){
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_accounts(telegram_id INTEGER PRIMARY KEY,name TEXT NOT NULL,points INTEGER NOT NULL CHECK(points>=0),defense INTEGER NOT NULL CHECK(defense>=0),charges INTEGER NOT NULL CHECK(charges>=0 AND charges<=10))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_purchases(idem TEXT PRIMARY KEY,telegram_id INTEGER NOT NULL,op TEXT NOT NULL,argument TEXT NOT NULL,created INTEGER NOT NULL)`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_shots(game INTEGER NOT NULL,actor INTEGER NOT NULL,target INTEGER NOT NULL,damage INTEGER NOT NULL,points INTEGER NOT NULL,PRIMARY KEY(game,actor))`);
 }
 private eligible(id:number){
  return this.sql.exec(`SELECT 1 FROM users u WHERE u.telegram_id=? AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM bans b WHERE b.telegram_id=u.telegram_id AND (b.expires_at IS NULL OR b.expires_at>?))`,id,this.clock()).length>0;
 }
 private busy(id:number){return this.sql.exec(`SELECT 1 FROM active_players WHERE telegram_id=?`,id).length>0;}
 private account(id:number):HeroRow|undefined{return this.sql.exec<HeroRow>(`SELECT * FROM hero_v2_accounts WHERE telegram_id=?`,id)[0];}
 private stats(row:HeroRow){
  const level=heroV2Level(row.points);
  const override=this.eco.isOwner(row.telegram_id)?this.sql.exec<{level:number}>(`SELECT level FROM hero_owner_levels WHERE telegram_id=?`,row.telegram_id)[0]?.level:undefined;
  return heroV2Stats(override??level);
 }
 private ensure(id:number):HeroRow|undefined{
  if(!this.eco.hasHero(id)||!this.eligible(id))return undefined;
  const row=this.account(id);if(row)return row;
  const points=this.sql.exec<{total_xp:number}>(`SELECT total_xp FROM hero_accounts WHERE telegram_id=?`,id)[0]?.total_xp??0;
  const initial:HeroRow={telegram_id:id,name:'Hypernova',points,defense:0,charges:HERO_V2_MAX_CHARGES};
  initial.defense=this.stats(initial).maxDefense;
  this.sql.exec(`INSERT INTO hero_v2_accounts(telegram_id,name,points,defense,charges) VALUES(?,?,?,?,?)`,id,initial.name,initial.points,initial.defense,initial.charges);
  return initial;
 }
 view(id:number){
  return this.sql.tx(()=>{
   const row=this.ensure(id);if(!row)return null;
   const stats=this.stats(row);
   return {name:row.name,points:row.points,defense:Math.min(row.defense,stats.maxDefense),charges:row.charges,...stats,nextPoints:heroV2Threshold(stats.level+1)};
  });
 }
 purchase(id:number,op:HeroV2Purchase,idem:string,argument=''):HeroV2BuyResult{
  if(!idem||idem.length>160||!this.eligible(id))return 'UNAVAILABLE';
  return this.sql.tx(()=>{
   const prior=this.sql.exec<{telegram_id:number;op:string;argument:string}>(`SELECT telegram_id,op,argument FROM hero_v2_purchases WHERE idem=?`,idem)[0];
   if(prior)return prior.telegram_id===id&&prior.op===op&&prior.argument===argument?'OK':'CONFLICT';
   if(this.busy(id))return 'UNAVAILABLE';
   const owner=this.eco.isOwner(id);
   const row=this.ensure(id);
   let currency:'DOLLAR'|'DIAMOND'='DOLLAR';let price:number;
   let deliver:()=>void;
   if(op==='BUY'){
    if(row)return 'FULL';
    price=HERO_V2_PRICE;currency='DIAMOND';
    deliver=()=>{
     this.sql.exec(`INSERT INTO inventory(telegram_id,item,qty) VALUES(?,'PERSONAL_HERO',1) ON CONFLICT(telegram_id,item) DO UPDATE SET qty=1`,id);
     if(!this.ensure(id))throw Error('hero creation failed');
    };
   }else{
    if(!row)return 'UNAVAILABLE';
    const stats=this.stats(row);
    if(op==='XP500'||op==='XP1000'){
     const pack=HERO_V2_XP_PACKS[op==='XP500'?0:1]!;
     const next=row.points+pack.points;if(!Number.isSafeInteger(next))return 'INVALID';
     price=pack.diamonds;currency='DIAMOND';
     deliver=()=>{this.sql.exec(`UPDATE hero_v2_accounts SET points=? WHERE telegram_id=?`,next,id);};
    }else if(op==='RESTORE'){
     if(row.defense>=stats.maxDefense)return 'FULL';
     price=stats.restorePrice;deliver=()=>{this.sql.exec(`UPDATE hero_v2_accounts SET defense=? WHERE telegram_id=?`,stats.maxDefense,id);};
    }else if(op==='RELOAD'){
     if(row.charges>=HERO_V2_MAX_CHARGES)return 'FULL';
     price=stats.reloadPrice;deliver=()=>{this.sql.exec(`UPDATE hero_v2_accounts SET charges=? WHERE telegram_id=?`,HERO_V2_MAX_CHARGES,id);};
    }else if(op==='RENAME'){
     const name=argument.trim();if(!name||Array.from(name).length>32||Array.from(name).some(c=>{const n=c.charCodeAt(0);return n<32||n===127;})||name===row.name)return 'INVALID';
     price=HERO_V2_RENAME_PRICE;deliver=()=>{this.sql.exec(`UPDATE hero_v2_accounts SET name=? WHERE telegram_id=?`,name,id);};
    }else return 'INVALID';
   }
   if(!owner&&(currency==='DIAMOND'?this.eco.diamonds(id):this.eco.coins(id))<price)return 'INSUFFICIENT';
   const key='hero-v2:'+idem;
   const ledger=currency==='DIAMOND'?this.eco.creditDiamonds(id,owner?0:-price,op,key):this.eco.credit(id,owner?0:-price,'HERO_V2',op,key);
   if(ledger.duplicate)throw Error('hero ledger without purchase receipt');
   deliver();
   this.sql.exec(`INSERT INTO hero_v2_purchases(idem,telegram_id,op,argument,created) VALUES(?,?,?,?,?)`,idem,id,op,argument,this.clock());
   return 'OK';
  });
 }
 /** Trusted game adapter only. The adapter supplies the target HP immediately before
  * the hit; this transaction persists hero charge, defense and score exactly once.
  * It must not be called directly on client-provided values.
  */
 settleShot(game:number,actor:number,target:number,targetHp:number,blocked:boolean){
  if(!Number.isSafeInteger(game)||game<1||actor===target||!Number.isInteger(targetHp)||targetHp<1||targetHp>100)return null;
  return this.sql.tx(()=>{
   if(this.sql.exec(`SELECT 1 FROM hero_v2_shots WHERE game=? AND actor=?`,game,actor).length)return null;
   const a=this.ensure(actor);if(!a||a.charges<1)return null;
   const t=this.ensure(target),stats=this.stats(a);
   const hit=heroV2Hit(targetHp,t?Math.min(t.defense,this.stats(t).maxDefense):0,blocked?0:stats.damage);
   const points=heroV2ShotPoints(stats.level,hit);
   if(!Number.isSafeInteger(a.points+points))throw Error('hero points overflow');
   this.sql.exec(`UPDATE hero_v2_accounts SET charges=charges-1,points=points+? WHERE telegram_id=?`,points,actor);
   if(t)this.sql.exec(`UPDATE hero_v2_accounts SET defense=? WHERE telegram_id=?`,hit.defense,target);
   this.sql.exec(`INSERT INTO hero_v2_shots(game,actor,target,damage,points) VALUES(?,?,?,?,?)`,game,actor,target,hit.lostHp,points);
   return {...hit,points};
  });
 }
}
