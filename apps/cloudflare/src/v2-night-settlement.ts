/** Trusted bridge for a locked night response snapshot. Persist the plan before
 * calling Registry; keep the room frozen until a matching receipt is committed.
 * Not exposed through the Telegram router or production RoomCore.
 */
import {seededRng,v2NightDebits,v2NightSessionReady} from '@mafia/game-engine';
import {v2RoomTick,type V2RoomSession} from './v2-room-session';
import type {GrenchDebit,GrenchBatchReceipt} from './role-v2-economy';
export type PendingV2NightSettlement={game:number;round:number;seq:number;revision:number;readyAt:number;debits:GrenchDebit[]};
export function prepareV2NightSettlement(room:V2RoomSession,now:number):PendingV2NightSettlement{
 if(!room.night||!v2NightSessionReady(room.night,now)||room.state.phase!=='NIGHT'||
   room.night.source.seq!==room.state.seq||room.night.source.round!==room.state.round)throw Error('night not ready');
 const debits=v2NightDebits(room.night,now).map(d=>({actor:Number(d.actor),target:Number(d.target),amount:d.amount}));
 if(debits.some(d=>!Number.isSafeInteger(d.actor)||d.actor<=0||!Number.isSafeInteger(d.target)||d.target<=0))throw Error('invalid player ID');
 return {game:room.game,round:room.state.round,seq:room.state.seq,revision:room.revision,readyAt:now,debits};
}
export function finalizeV2NightSettlement(room:V2RoomSession,pending:PendingV2NightSettlement,receipt:GrenchBatchReceipt,now:number){
 if(now<pending.readyAt||receipt.status!=='OK')throw Error('night receipt unavailable');
 const current=prepareV2NightSettlement(room,pending.readyAt);
 if(JSON.stringify(current)!==JSON.stringify(pending)||receipt.game!==pending.game||receipt.round!==pending.round||receipt.entries.length!==pending.debits.length)throw Error('night receipt mismatch');
 const receipts=new Map<string,'PAID'|'INSUFFICIENT'>();
 for(let i=0;i<pending.debits.length;i++){
  const d=pending.debits[i]!,entry=receipt.entries[i]!;
  if(entry.actor!==d.actor||entry.target!==d.target||entry.amount!==d.amount||!['PAID','INSUFFICIENT'].includes(entry.status))throw Error('night debit mismatch');
  receipts.set('g:'+d.actor,entry.status);
 }
 // The room already contains the seeded night session. RNG is not consulted.
 const next=v2RoomTick(room,now,seededRng(0),receipts);
 if(next.room.night||next.room.state.phase==='NIGHT')throw Error('night did not finalize');
 return next;
}
