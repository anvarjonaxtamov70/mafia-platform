/** V2 reservations are fixed at start. Seller purchases do not change them. */
import type {RoomGame} from './room-core';
export function applyV2Loadout(g:RoomGame,items:NonNullable<RoomGame['arcade']>):void{
 const room=g.v2Session;
 if(!room||room.state.phase!=='NIGHT'||room.state.round!==1||room.state.intents.length||room.night)throw Error('v2 loadout after start');
 if(Object.keys(items).some(id=>!room.state.players.some(p=>p.id===id)))throw Error('unknown loadout player');
 g.arcade=items;
 for(const p of room.state.players){
  const i=items[p.id];
  p.shield=i?.shield?1:0;p.document=!!i?.fakeDocument;p.voteShield=!!i?.voteShield;p.heroShield=!!i?.heroShield;
 }
}
export function usedV2Items(g:RoomGame):Record<string,string[]>{
 const used:Record<string,string[]>={};
 for(const [id,i] of Object.entries(g.arcade??{})){
  const p=g.v2Session?.state.players.find(x=>x.id===id);
  if(!p)throw Error('missing v2 loadout player');
  const codes:string[]=[];
  if(i.shield&&p.shield===0)codes.push('SHIELD');
  if(i.fakeDocument&&!p.document)codes.push('FAKE_DOC');
  if(i.voteShield&&!p.voteShield)codes.push('VOTE_SHIELD');
  if(i.heroShield&&!p.heroShield)codes.push('HERO_SHIELD');
  if(codes.length)used[id]=codes;
 }
 return used;
}
