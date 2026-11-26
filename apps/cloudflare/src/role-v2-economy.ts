/** Trusted room adapter only: no direct Telegram-facing mint/debit RPC. */
import {catalogItem} from '@mafia/bot-core';
import type {EconomyCore} from './economy-core';
import type {Sql} from './sql';
export type Receipt='PAID'|'INSUFFICIENT'|'UNAVAILABLE'|'CONFLICT';
type EventRow={actor:number;target:number;amount:number;status:Receipt};
type Offer={id:number;game:number;round:number;seller:number;buyer:number;expires:number;item:string|null};
export type GrenchDebit={actor:number;target:number;amount:number};
export type GrenchBatchReceipt={status:'OK';game:number;round:number;entries:(GrenchDebit&{status:'PAID'|'INSUFFICIENT'})[]}|{status:'UNAVAILABLE'|'CONFLICT'};
export type DawnRoleAction={kind:'KLAUS';actor:number;target:number;amount:number}|{kind:'SELLER';actor:number;target:number};
export type DawnRoleEntry={kind:'KLAUS';actor:number;target:number;amount:number}|{kind:'SELLER';actor:number;target:number;offer:number;expires:number};
export type DawnRoleReceipt={status:'OK';game:number;round:number;entries:DawnRoleEntry[]}|{status:'UNAVAILABLE'|'CONFLICT'};
class GrenchBatchAbort extends Error{
 constructor(readonly status:'UNAVAILABLE'|'CONFLICT'){super(status);}
}
export class RoleV2Economy {
 constructor(private readonly sql:Sql,private readonly eco:EconomyCore,private readonly clock:()=>number){}
 migrate(){
  this.sql.exec(`CREATE TABLE IF NOT EXISTS role_v2_receipts(game INTEGER NOT NULL,round INTEGER NOT NULL,kind TEXT NOT NULL,actor INTEGER NOT NULL,target INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(game,round,kind,actor))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS role_v2_grench_batches(game INTEGER NOT NULL,round INTEGER NOT NULL,request TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(game,round))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS role_v2_dawn_batches(game INTEGER NOT NULL,round INTEGER NOT NULL,request TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(game,round))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS role_v2_offers(id INTEGER PRIMARY KEY AUTOINCREMENT,game INTEGER NOT NULL,round INTEGER NOT NULL,seller INTEGER NOT NULL,buyer INTEGER NOT NULL,expires INTEGER NOT NULL,item TEXT,UNIQUE(game,round,seller))`);
 }
 private valid(game:number,round:number,actor:number,target:number){
  return Number.isSafeInteger(game)&&game>0&&Number.isSafeInteger(round)&&round>0&&actor!==target&&
   this.sql.exec(`SELECT 1 FROM games WHERE number=? AND status='RUNNING'`,game).length===1&&
   this.sql.exec(`SELECT 1 FROM active_players a JOIN users u ON u.telegram_id=a.telegram_id WHERE a.game_number=? AND a.telegram_id IN (?,?) AND u.deleted_at IS NULL`,game,actor,target).length===2;
 }
 private existing(game:number,round:number,kind:string,actor:number,target:number,amount:number):Receipt|undefined{
  const row=this.sql.exec<EventRow>(`SELECT actor,target,amount,status FROM role_v2_receipts WHERE game=? AND round=? AND kind=? AND actor=?`,game,round,kind,actor)[0];
  return row?(row.target===target&&row.amount===amount?row.status:'CONFLICT'):undefined;
 }
 private receipt(game:number,round:number,kind:string,actor:number,target:number,amount:number,status:Receipt){
  this.sql.exec(`INSERT INTO role_v2_receipts(game,round,kind,actor,target,amount,status) VALUES(?,?,?,?,?,?,?)`,game,round,kind,actor,target,amount,status);
  return status;
 }
 /** A transfer of real earned virtual dollars, never a transfer of unlimited owner allowance. */
 grench(game:number,round:number,actor:number,target:number,amount:number):Receipt{
  if(!Number.isSafeInteger(amount)||amount<50||amount>150||amount%10!==0)return 'UNAVAILABLE';
  return this.sql.tx(()=>{
   const prior=this.existing(game,round,'GRENCH',actor,target,amount);if(prior)return prior;
   if(!this.valid(game,round,actor,target))return 'UNAVAILABLE';
   if(this.eco.coins(target)<amount)return this.receipt(game,round,'GRENCH',actor,target,amount,'INSUFFICIENT');
   const key='v2:g:'+game+':'+round+':'+actor;
   if(this.eco.credit(target,-amount,'GRENCH',String(game),key+':debit').duplicate)throw Error('missing transfer receipt');
   if(this.eco.credit(actor,amount,'GRENCH',String(game),key+':credit').duplicate)throw Error('missing transfer receipt');
   return this.receipt(game,round,'GRENCH',actor,target,amount,'PAID');
  });
 }
 /** Atomic settlement for the frozen night plan. Request ordering is preserved
  * because multiple Grench actors can target the same finite balance.
  * A conflicting or unavailable member aborts the entire transaction.
  */
 settleGrenchBatch(game:number,round:number,debits:readonly GrenchDebit[]):GrenchBatchReceipt{
  if(!Number.isSafeInteger(game)||game<1||!Number.isSafeInteger(round)||round<1||debits.length>30||
   new Set(debits.map(d=>d.actor)).size!==debits.length||
   debits.some(d=>![d.actor,d.target,d.amount].every(Number.isSafeInteger)||d.actor<1||d.target<1||d.actor===d.target||d.amount<50||d.amount>150||d.amount%10!==0))return {status:'UNAVAILABLE'};
  const canonical=debits.map(d=>({actor:d.actor,target:d.target,amount:d.amount}));
  const key=JSON.stringify(canonical);
  try{return this.sql.tx(()=>{
   const prior=this.sql.exec<{request:string;receipt:string}>(`SELECT request,receipt FROM role_v2_grench_batches WHERE game=? AND round=?`,game,round)[0];
   if(prior)return prior.request===key?JSON.parse(prior.receipt) as GrenchBatchReceipt:{status:'CONFLICT'};
   if(!this.sql.exec(`SELECT 1 FROM games WHERE number=? AND status='RUNNING'`,game).length)return {status:'UNAVAILABLE'};
   const entries:(GrenchDebit&{status:'PAID'|'INSUFFICIENT'})[]=[];
   for(const d of canonical){
    const status=this.grench(game,round,d.actor,d.target,d.amount);
    if(status==='CONFLICT'||status==='UNAVAILABLE')throw new GrenchBatchAbort(status);
    entries.push({...d,status});
   }
   const receipt={status:'OK' as const,game,round,entries};
   this.sql.exec(`INSERT INTO role_v2_grench_batches(game,round,request,receipt) VALUES(?,?,?,?)`,game,round,key,JSON.stringify(receipt));
   return receipt;
  });}catch(error){if(error instanceof GrenchBatchAbort)return {status:error.status};throw error;}
 }
 /** Klaus creates a bounded in-game gift, separate from ordinary match rewards. */
 klaus(game:number,round:number,actor:number,target:number,amount:number):Receipt{
  if(!Number.isSafeInteger(amount)||amount<50||amount>200)return 'UNAVAILABLE';
  return this.sql.tx(()=>{
   const prior=this.existing(game,round,'KLAUS',actor,target,amount);if(prior)return prior;
   if(!this.valid(game,round,actor,target))return 'UNAVAILABLE';
   if(this.eco.credit(target,amount,'KLAUS',String(game),'v2:k:'+game+':'+round+':'+actor).duplicate)throw Error('missing gift receipt');
   return this.receipt(game,round,'KLAUS',actor,target,amount,'PAID');
  });
 }
 offer(game:number,round:number,seller:number,buyer:number):number|null{
  return this.sql.tx(()=>{
   const previous=this.sql.exec<Offer>(`SELECT * FROM role_v2_offers WHERE game=? AND round=? AND seller=?`,game,round,seller)[0];
   if(previous)return previous.buyer===buyer?previous.id:null;
   if(!this.valid(game,round,seller,buyer))return null;
   return this.sql.exec<{id:number}>(`INSERT INTO role_v2_offers(game,round,seller,buyer,expires) VALUES(?,?,?,?,?) RETURNING id`,game,round,seller,buyer,this.clock()+60000)[0]!.id;
  });
 }
 /** Freeze the exact dawn effects in an atomic, replayable receipt. */
 settleDawn(game:number,round:number,actions:readonly DawnRoleAction[]):DawnRoleReceipt{
  if(!Number.isSafeInteger(game)||game<1||!Number.isSafeInteger(round)||round<1||actions.length>30||
    new Set(actions.map(a=>a.actor)).size!==actions.length||
    actions.some(a=>![a.actor,a.target].every(Number.isSafeInteger)||a.actor<1||a.target<1||a.actor===a.target||
     (a.kind==='KLAUS'?(!Number.isSafeInteger(a.amount)||a.amount<50||a.amount>200):a.kind!=='SELLER')))return {status:'UNAVAILABLE'};
  const canonical=actions.map(a=>a.kind==='KLAUS'?{kind:a.kind,actor:a.actor,target:a.target,amount:a.amount}:{kind:a.kind,actor:a.actor,target:a.target});
  const request=JSON.stringify(canonical);
  try{return this.sql.tx(()=>{
   const prior=this.sql.exec<{request:string;receipt:string}>(`SELECT request,receipt FROM role_v2_dawn_batches WHERE game=? AND round=?`,game,round)[0];
   if(prior)return prior.request===request?JSON.parse(prior.receipt) as DawnRoleReceipt:{status:'CONFLICT'};
   if(!this.sql.exec(`SELECT 1 FROM games WHERE number=? AND status='RUNNING'`,game).length)return {status:'UNAVAILABLE'};
   const entries:DawnRoleEntry[]=[];
   for(const a of actions){
    if(a.kind==='KLAUS'){
     const result=this.klaus(game,round,a.actor,a.target,a.amount);
     if(result!=='PAID')throw new GrenchBatchAbort(result==='CONFLICT'?'CONFLICT':'UNAVAILABLE');
     entries.push({kind:a.kind,actor:a.actor,target:a.target,amount:a.amount});
    }else{
     const offer=this.offer(game,round,a.actor,a.target);
     if(offer===null)throw new GrenchBatchAbort('UNAVAILABLE');
     const row=this.sql.exec<Offer>(`SELECT * FROM role_v2_offers WHERE id=?`,offer)[0]!;
     entries.push({kind:a.kind,actor:a.actor,target:a.target,offer,expires:row.expires});
    }
   }
   const receipt={status:'OK' as const,game,round,entries};
   this.sql.exec(`INSERT INTO role_v2_dawn_batches(game,round,request,receipt) VALUES(?,?,?,?)`,game,round,request,JSON.stringify(receipt));
   return receipt;
  });}catch(error){if(error instanceof GrenchBatchAbort)return {status:error.status};throw error;}
 }
 /** One discounted consumable per offer. No VIP, hero, real-money or legacy cosmetics.
  * Commission is 10% of actual amount paid, floored in the same currency.
  */
 buyOffer(buyer:number,id:number,code:string):Receipt{
  return this.sql.tx(()=>{
   const offer=this.sql.exec<Offer>(`SELECT * FROM role_v2_offers WHERE id=? AND buyer=?`,id,buyer)[0];
   if(!offer)return 'UNAVAILABLE';
   if(offer.item)return offer.item===code?'PAID':'CONFLICT';
   if(offer.expires<=this.clock()||!this.valid(offer.game,offer.round,offer.seller,buyer))return 'UNAVAILABLE';
   const item=catalogItem(code);
   if(!item||item.kind!=='ARCADE'||item.price===null)return 'UNAVAILABLE';
   const price=Math.ceil(item.price/2),diamond=item.currency==='DIAMOND',owner=this.eco.isOwner(buyer);
   if(!owner&&(diamond?this.eco.diamonds(buyer):this.eco.coins(buyer))<price)return 'INSUFFICIENT';
   const amount=owner?0:price,commission=Math.floor(amount/10),key='v2:s:'+id;
   const debit=diamond?this.eco.creditDiamonds(buyer,-amount,'SELLER_BUY',key+':debit'):this.eco.credit(buyer,-amount,'SELLER_BUY',code,key+':debit');
   if(debit.duplicate)throw Error('missing offer receipt');
   if(commission){
    const credit=diamond?this.eco.creditDiamonds(offer.seller,commission,'SELLER_COMMISSION',key+':credit'):this.eco.credit(offer.seller,commission,'SELLER_COMMISSION',code,key+':credit');
    if(credit.duplicate)throw Error('missing offer commission receipt');
   }
   this.sql.exec(`INSERT INTO inventory(telegram_id,item,qty) VALUES(?,?,1) ON CONFLICT(telegram_id,item) DO UPDATE SET qty=qty+1`,buyer,code);
   this.sql.exec(`UPDATE role_v2_offers SET item=? WHERE id=?`,code,id);
   return 'PAID';
  });
 }
}
