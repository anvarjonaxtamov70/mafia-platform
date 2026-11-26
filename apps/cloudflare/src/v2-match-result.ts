import {V2_DEFS,type PlayerOutcome} from '@mafia/game-engine';
import type {RecordGameInput} from './registry-core';
import type {RoomGame} from './room-core';
export function buildV2Result(g:RoomGame,chatId:number,finishedAt:number):RecordGameInput{
 const state=g.v2Session?.state;
 if(!state||state.phase!=='ENDED'||!state.outcome||state.players.length!==g.players.length)throw Error('v2 result not final');
 const result=state.outcome,winners=new Set(result.winners);
 const outcome=result.reason as RecordGameInput['outcome'];
 return {gameId:g.id,number:g.number,chatId,engineVersion:2,mode:state.mode,ranked:g.config.ranked&&!g.players.some(p=>p.fake),practice:g.players.some(p=>p.fake),outcome,days:state.round,rewardVersion:1,completedAt:finishedAt,durationMs:Math.max(0,finishedAt-(g.startedAt??finishedAt)),players:state.players.map(p=>{
  const user=g.players.find(u=>String(u.id)===p.id);if(!user)throw Error('missing player');
  const faction=V2_DEFS[p.role].faction;
  const afk=p.death==='AFK',left=p.left||afk,won=winners.has(p.id)&&!left;
  const main=state.mode==='VS'||result.reason===faction&&(faction!=='NEUTRAL')||result.reason==='SUIDSID'&&p.role==='SUIDSID';
  const outcome:PlayerOutcome=left?'LOSS':won?(main?'WIN':'PERSONAL_WIN'):result.reason==='DRAW'&&p.personal!=='LOSS'?'DRAW':'LOSS';
  const missed=p.missedTotal??p.missed;
  return {tgId:user.id,name:user.name,role:p.role,faction,outcome,survived:p.hp>0&&!left,left,active:missed===0&&!left,afk,missed,fake:user.fake,...(user.badge?{badge:user.badge}:{})};
 })};
}
