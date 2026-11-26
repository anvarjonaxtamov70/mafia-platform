/** Prepare/finalize are pure. A live caller must persist the pending request
 * before contacting Registry and freeze room mutation until its receipt is saved.
 * This module is intentionally not routed to the production bot yet.
 */
import {decodeV2Button} from '@mafia/bot-core';
import {v2RoomButton,type V2RoomSession,type V2RoomTransition} from './v2-room-session';
import type {HeroV2ShotRequest,HeroV2ShotReceipt} from './hero-v2-core';
export type PendingV2HeroShot={revision:number;acceptedAt:number;raw:string;request:HeroV2ShotRequest};
export function prepareV2HeroShot(room:V2RoomSession,actor:number,chat:number,raw:string,now:number):PendingV2HeroShot{
 const button=decodeV2Button(raw);
 if(button?.op!=='H')throw Error('not a hero shot');
 // Validate role, target, phase, private actor and deadline with the same engine.
 const tentative=v2RoomButton(room,actor,chat,raw,now);
 if(!tentative.effects.some(e=>e.kind==='HERO'))throw Error('no hero effect');
 const a=room.state.players.find(p=>p.id===String(actor))!,t=room.state.players[button.seat-1]!;
 const target=Number(t.id);
 if(!Number.isSafeInteger(target)||target<=0||!Number.isSafeInteger(actor)||actor<=0)throw Error('invalid hero IDs');
 return {revision:room.revision,acceptedAt:now,raw,request:{game:room.game,seq:room.state.seq,actor,target,targetHp:t.hp,blocked:t.heroShield,actorCharges:a.heroCharges,damage:a.heroDamage,targetDefense:t.heroDefense}};
}
export function finalizeV2HeroShot(room:V2RoomSession,pending:PendingV2HeroShot,receipt:HeroV2ShotReceipt):V2RoomTransition{
 const r=pending.request;
 if(receipt.status!=='PAID'||room.revision!==pending.revision)throw Error('hero receipt unavailable or stale');
 const canonical=prepareV2HeroShot(room,r.actor,r.actor,pending.raw,pending.acceptedAt);
 if(JSON.stringify(canonical.request)!==JSON.stringify(r)||JSON.stringify(receipt.request)!==JSON.stringify(r))throw Error('hero receipt request mismatch');
 const next=v2RoomButton(room,r.actor,r.actor,pending.raw,pending.acceptedAt);
 const a=next.room.state.players.find(p=>p.id===String(r.actor))!,t=next.room.state.players.find(p=>p.id===String(r.target))!;
 const effect=next.effects.find(e=>e.kind==='HERO');
 if(!effect||effect.kind!=='HERO'||receipt.hp!==t.hp||receipt.defense!==t.heroDefense||receipt.charges!==a.heroCharges||
   receipt.absorbed!==effect.absorbed||receipt.lostHp!==effect.hpLost||receipt.killed!==effect.killed)throw Error('hero receipt outcome mismatch');
 return next;
}
