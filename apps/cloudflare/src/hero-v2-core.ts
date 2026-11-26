/** Draft v2 persistence. Uses existing transaction/ledger; not exposed to Telegram
 * until v2 rooms can atomically snapshot, reserve and settle their hero shots.
 */
import {HERO_V2_PRICE,HERO_V2_MAX_CHARGES,HERO_V2_RENAME_PRICE,HERO_V2_XP_PACKS,heroV2Level,heroV2Stats,heroV2Threshold,heroV2ShotPoints,heroV2Hit} from '@mafia/bot-core';
import type {Sql} from './sql';
import type {EconomyCore} from './economy-core';
type HeroRow={telegram_id:number;name:string;points:number;defense:number;charges:number};
export type HeroV2Purchase='BUY'|'XP500'|'XP1000'|'RESTORE'|'RELOAD'|'RENAME';
export type HeroV2BuyResult='OK'|'UNAVAILABLE'|'INSUFFICIENT'|'FULL'|'INVALID'|'CONFLICT';
export type HeroV2Quote={id:number;op:HeroV2Purchase;argument:string;price:number;currency:'DOLLAR'|'DIAMOND';expires:number};
type QuoteRow={id:number;telegram_id:number;op:HeroV2Purchase;argument:string;price:number;currency:'DOLLAR'|'DIAMOND';expires:number;result:HeroV2BuyResult|null};
export type HeroV2QuoteResult={status:'OK';quote:HeroV2Quote}|{status:Exclude<HeroV2BuyResult,'OK'>};
export type HeroV2ShotRequest={
 game:number;seq:number;actor:number;target:number;targetHp:number;blocked:boolean;
 actorCharges:number;damage:number;targetDefense:number;
};
export type HeroV2ShotReceipt=({status:'PAID';request:HeroV2ShotRequest;points:number;charges:number}&ReturnType<typeof heroV2Hit>)|{status:'UNAVAILABLE'|'CONFLICT'};
export class HeroV2Core {
 constructor(private readonly sql:Sql,private readonly eco:EconomyCore,private readonly clock:()=>number){}
 migrate(){
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_accounts(telegram_id INTEGER PRIMARY KEY,name TEXT NOT NULL,points INTEGER NOT NULL CHECK(points>=0),defense INTEGER NOT NULL CHECK(defense>=0),charges INTEGER NOT NULL CHECK(charges>=0 AND charges<=10))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_purchases(idem TEXT PRIMARY KEY,telegram_id INTEGER NOT NULL,op TEXT NOT NULL,argument TEXT NOT NULL,created INTEGER NOT NULL)`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_quotes(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id INTEGER NOT NULL,op TEXT NOT NULL,argument TEXT NOT NULL,price INTEGER NOT NULL,currency TEXT NOT NULL,expires INTEGER NOT NULL,result TEXT)`);
  this.sql.exec(`CREATE INDEX IF NOT EXISTS hero_v2_quotes_user ON hero_v2_quotes(telegram_id,id)`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_shots(game INTEGER NOT NULL,actor INTEGER NOT NULL,target INTEGER NOT NULL,damage INTEGER NOT NULL,points INTEGER NOT NULL,PRIMARY KEY(game,actor))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS hero_v2_shot_receipts(game INTEGER NOT NULL,actor INTEGER NOT NULL,request TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(game,actor))`);
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
 private price(id:number,op:HeroV2Purchase,argument:string):{price:number;currency:'DOLLAR'|'DIAMOND'}|Exclude<HeroV2BuyResult,'OK'>{
  if(!this.eligible(id)||this.busy(id))return 'UNAVAILABLE';
  const row=this.ensure(id);
  if(op==='BUY')return row?'FULL':{price:HERO_V2_PRICE,currency:'DIAMOND'};
  if(!row)return 'UNAVAILABLE';
  const stats=this.stats(row);
  if(op==='XP500'||op==='XP1000'){
   const pack=HERO_V2_XP_PACKS[op==='XP500'?0:1]!;
   if(!Number.isSafeInteger(row.points+pack.points))return 'INVALID';
   return {price:pack.diamonds,currency:'DIAMOND'};
  }
  if(op==='RESTORE')return row.defense>=stats.maxDefense?'FULL':{price:stats.restorePrice,currency:'DOLLAR'};
  if(op==='RELOAD')return row.charges>=HERO_V2_MAX_CHARGES?'FULL':{price:stats.reloadPrice,currency:'DOLLAR'};
  if(op==='RENAME'){
   const name=argument.trim();
   if(!name||Array.from(name).length>32||Array.from(name).some(c=>{const n=c.charCodeAt(0);return n<32||n===127;})||name===row.name)return 'INVALID';
   return {price:HERO_V2_RENAME_PRICE,currency:'DOLLAR'};
  }
  return 'INVALID';
 }
 /** Quotes bind displayed price and exact name to one account. Only one outstanding
  * confirmation per user; a newer quote invalidates the older one. */
 quote(id:number,op:HeroV2Purchase,argument=''):HeroV2QuoteResult{
  return this.sql.tx(()=>{
   if(op!=='RENAME'&&argument)return {status:'INVALID'};
   const arg=argument.trim(),cost=this.price(id,op,arg);
   if(typeof cost==='string')return {status:cost};
   const expires=this.clock()+120000,price=this.eco.isOwner(id)?0:cost.price;
   this.sql.exec(`UPDATE hero_v2_quotes SET result='UNAVAILABLE' WHERE telegram_id=? AND result IS NULL`,id);
   const q=this.sql.exec<{id:number}>(`INSERT INTO hero_v2_quotes(telegram_id,op,argument,price,currency,expires) VALUES(?,?,?,?,?,?) RETURNING id`,id,op,arg,price,cost.currency,expires)[0]!;
   return {status:'OK',quote:{id:q.id,op,argument:arg,price,currency:cost.currency,expires}};
  });
 }
 cancel(id:number,quoteId:number):void{
  if(!Number.isSafeInteger(quoteId)||quoteId<1)return;
  this.sql.exec(`UPDATE hero_v2_quotes SET result='UNAVAILABLE' WHERE id=? AND telegram_id=? AND result IS NULL`,quoteId,id);
 }
 confirm(id:number,quoteId:number):HeroV2BuyResult{
  if(!Number.isSafeInteger(quoteId)||quoteId<1||!this.eligible(id))return 'UNAVAILABLE';
  return this.sql.tx(()=>{
   const q=this.sql.exec<QuoteRow>(`SELECT * FROM hero_v2_quotes WHERE id=? AND telegram_id=?`,quoteId,id)[0];
   if(!q)return 'UNAVAILABLE';
   if(q.result)return q.result;
   let result:HeroV2BuyResult;
   if(q.expires<=this.clock())result='UNAVAILABLE';
   else{
    const cost=this.price(id,q.op,q.argument);
    if(typeof cost==='string')result=cost;
    else if(cost.currency!==q.currency||(this.eco.isOwner(id)?0:cost.price)!==q.price)result='CONFLICT';
    else result=this.purchase(id,q.op,'quote:'+q.id,q.argument);
   }
   this.sql.exec(`UPDATE hero_v2_quotes SET result=? WHERE id=?`,result,q.id);
   return result;
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
 /** Trusted room adapter only. A persisted request identifies an accepted shot.
  * Replay returns the same committed receipt, including after match cleanup.
  * A different request with the same game/actor is never a second charge.
  */
 settleShot(input:HeroV2ShotRequest):HeroV2ShotReceipt{
  const {game,seq,actor,target,targetHp,blocked,actorCharges,damage,targetDefense}=input;
  if(![game,seq,actor,target,targetHp,actorCharges,damage,targetDefense].every(Number.isSafeInteger)||
    game<1||seq<1||actor<1||target<1||actor===target||targetHp<1||targetHp>100||
    actorCharges<1||actorCharges>HERO_V2_MAX_CHARGES||damage<45||damage>100||targetDefense<0||typeof blocked!=='boolean')return {status:'UNAVAILABLE'};
  // Canonical order: callers may reconstruct a request after serialization.
  const request={game,seq,actor,target,targetHp,blocked,actorCharges,damage,targetDefense};
  const key=JSON.stringify(request);
  return this.sql.tx(()=>{
   const prior=this.sql.exec<{request:string;receipt:string}>(`SELECT request,receipt FROM hero_v2_shot_receipts WHERE game=? AND actor=?`,game,actor)[0];
   if(prior)return prior.request===key?JSON.parse(prior.receipt) as HeroV2ShotReceipt:{status:'CONFLICT'};
   // Legacy draft records lack enough data for a safe replay. Fail closed.
   if(this.sql.exec(`SELECT 1 FROM hero_v2_shots WHERE game=? AND actor=?`,game,actor).length)return {status:'CONFLICT'};
   if(!this.sql.exec(`SELECT 1 FROM games WHERE number=? AND status='RUNNING'`,game).length||
     this.sql.exec(`SELECT 1 FROM active_players a JOIN games g ON g.number=a.game_number AND g.chat_id=a.chat_id WHERE a.game_number=? AND a.telegram_id IN (?,?)`,game,actor,target).length!==2||
     !this.eligible(actor)||!this.eligible(target))return {status:'UNAVAILABLE'};
   const a=this.ensure(actor);if(!a)return {status:'UNAVAILABLE'};
   const t=this.ensure(target),stats=this.stats(a);
   const defense=t?Math.min(t.defense,this.stats(t).maxDefense):0;
   if(a.charges!==actorCharges||stats.damage!==damage||defense!==targetDefense)return {status:'CONFLICT'};
   const hit=heroV2Hit(targetHp,defense,blocked?0:damage);
   const points=heroV2ShotPoints(stats.level,hit);
   if(!Number.isSafeInteger(a.points+points))throw Error('hero points overflow');
   this.sql.exec(`UPDATE hero_v2_accounts SET charges=charges-1,points=points+? WHERE telegram_id=?`,points,actor);
   if(t)this.sql.exec(`UPDATE hero_v2_accounts SET defense=? WHERE telegram_id=?`,hit.defense,target);
   const receipt={status:'PAID' as const,request,...hit,points,charges:a.charges-1};
   this.sql.exec(`INSERT INTO hero_v2_shots(game,actor,target,damage,points) VALUES(?,?,?,?,?)`,game,actor,target,hit.lostHp,points);
   this.sql.exec(`INSERT INTO hero_v2_shot_receipts(game,actor,request,receipt) VALUES(?,?,?,?)`,game,actor,key,JSON.stringify(receipt));
   return receipt;
  });
 }
}
