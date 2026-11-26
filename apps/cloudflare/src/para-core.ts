import type {Sql} from './sql';
export type ParaResult = 'OK'|'UNAVAILABLE'|'PAIRED'|'RATE'|'STALE';
export type ParaRequest = {ok:true;id:number;name:string}|{ok:false;error:ParaResult};
export type ParaPair = {id:number;partner:string};
type RequestRow={id:number;sender:number;target:number;state:string;expires:number;created:number};
export class ParaCore {
 constructor(private readonly sql:Sql,private readonly clock:()=>number){}
 migrate(){
  this.sql.exec(`CREATE TABLE IF NOT EXISTS para_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,sender INTEGER NOT NULL,target INTEGER NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL)`);
  this.sql.exec(`CREATE INDEX IF NOT EXISTS para_sender ON para_requests(sender,created)`);
  this.sql.exec(`CREATE INDEX IF NOT EXISTS para_target ON para_requests(target,state,expires)`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS para_members(user_id INTEGER PRIMARY KEY,pair_id INTEGER NOT NULL)`);
  this.sql.exec(`CREATE INDEX IF NOT EXISTS para_pair ON para_members(pair_id)`);
 }
 private eligible(id:number,dm=false){
  return this.sql.exec(`SELECT 1 FROM users u WHERE u.telegram_id=? AND u.deleted_at IS NULL AND (?=0 OR (u.dm_available=1 AND u.dm_blocked_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM bans b WHERE b.telegram_id=u.telegram_id AND (b.expires_at IS NULL OR b.expires_at>?))`,id,dm?1:0,this.clock()).length>0;
 }
 private name(id:number){
  const u=this.sql.exec<{first_name:string;last_name:string|null}>(`SELECT first_name,last_name FROM users WHERE telegram_id=?`,id)[0];
  return u?[u.first_name,u.last_name].filter(Boolean).join(' ').slice(0,64):'O‘yinchi';
 }
 private member(id:number){return this.sql.exec<{pair_id:number}>(`SELECT pair_id FROM para_members WHERE user_id=?`,id)[0];}
 private invalidate(id:number){this.sql.exec(`UPDATE para_requests SET state='CANCELLED' WHERE state='PENDING' AND (sender=? OR target=?)`,id,id);}
 request(sender:number,target:number):ParaRequest{
  return this.sql.tx(()=>{
   const now=this.clock();
   if(sender===target||!this.eligible(sender)||!this.eligible(target,true))return {ok:false,error:'UNAVAILABLE'};
   if(this.member(sender)||this.member(target))return {ok:false,error:'PAIRED'};
   this.sql.exec(`UPDATE para_requests SET state='EXPIRED' WHERE state='PENDING' AND expires<=?`,now);
   if(this.sql.exec(`SELECT 1 FROM para_requests WHERE sender=? AND (state='PENDING' OR created>?)`,sender,now-60000).length)return {ok:false,error:'RATE'};
   if(this.sql.exec<{n:number}>(`SELECT count(*) AS n FROM para_requests WHERE target=? AND state='PENDING'`,target)[0]!.n>=5)return {ok:false,error:'RATE'};
   const row=this.sql.exec<{id:number}>(`INSERT INTO para_requests(sender,target,state,expires,created) VALUES(?,?,'PENDING',?,?) RETURNING id`,sender,target,now+600000,now)[0]!;
   return {ok:true,id:row.id,name:this.name(sender)};
  });
 }
 failed(sender:number,id:number){this.sql.exec(`UPDATE para_requests SET state='CANCELLED' WHERE id=? AND sender=? AND state='PENDING'`,id,sender);}
 answer(target:number,id:number,accept:boolean):ParaResult{
  return this.sql.tx(()=>{
   const r=this.sql.exec<RequestRow>(`SELECT * FROM para_requests WHERE id=? AND target=?`,id,target)[0];
   if(!r||r.state!=='PENDING'||r.expires<=this.clock())return 'STALE';
   if(!accept){this.sql.exec(`UPDATE para_requests SET state='REJECTED' WHERE id=?`,id);return 'OK';}
   if(!this.eligible(target,true)||!this.eligible(r.sender))return 'UNAVAILABLE';
   if(this.member(target)||this.member(r.sender))return 'PAIRED';
   this.sql.exec(`INSERT INTO para_members(user_id,pair_id) VALUES(?,?),(?,?)`,r.sender,id,target,id);
   this.sql.exec(`UPDATE para_requests SET state='ACCEPTED' WHERE id=?`,id);
   this.invalidate(target);this.invalidate(r.sender);return 'OK';
  });
 }
 pair(user:number):ParaPair|null{
  const row=this.sql.exec<{pair_id:number;user_id:number}>(`SELECT other.pair_id,other.user_id FROM para_members me JOIN para_members other ON me.pair_id=other.pair_id AND other.user_id<>me.user_id WHERE me.user_id=?`,user)[0];
  return row?{id:row.pair_id,partner:this.name(row.user_id)}:null;
 }
 leave(user:number,pair:number):ParaResult{
  return this.sql.tx(()=>{
   if(this.member(user)?.pair_id!==pair)return 'STALE';
   this.sql.exec(`DELETE FROM para_members WHERE pair_id=?`,pair);this.invalidate(user);return 'OK';
  });
 }
 remove(user:number){this.sql.tx(()=>{const m=this.member(user);if(m)this.sql.exec(`DELETE FROM para_members WHERE pair_id=?`,m.pair_id);this.invalidate(user);});}
}
