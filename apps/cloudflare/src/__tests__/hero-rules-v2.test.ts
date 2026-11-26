import {describe,it,expect} from 'vitest';
import {heroV2Threshold,heroV2Level,heroV2Stats,heroV2Hit,heroV2CanShoot,HERO_V2_PRICE,HERO_V2_XP_PACKS} from '@mafia/bot-core';
describe('v16 proposed hero rules',()=>{
  it('matches the two observed thresholds, defense and price examples',()=>{
    expect(heroV2Level(2423)).toBe(3);
    expect(heroV2Level(50996)).toBe(47);
    expect(heroV2Threshold(4)).toBe(3300);
    expect(heroV2Threshold(48)).toBe(51700);
    expect(heroV2Stats(3)).toMatchObject({damage:57,maxDefense:25,restorePrice:400,reloadPrice:405});
    expect(heroV2Stats(47)).toMatchObject({damage:100,maxDefense:391,restorePrice:4800,reloadPrice:4805});
    expect(HERO_V2_PRICE).toBe(90);
    expect(HERO_V2_XP_PACKS).toEqual([{points:500,diamonds:35},{points:1000,diamonds:65}]);
  });
  it('uses integer damage and progressively higher thresholds without fixed gameplay cap',()=>{
    expect(Array.from({length:10},(_,i)=>heroV2Stats(i+1).damage)).toEqual([45,51,57,63,69,76,82,88,94,100]);
    for(const level of [1,2,3,47,50,51,100,1000,1000000]){
      const points=heroV2Threshold(level);
      expect(heroV2Level(points)).toBe(level);
      expect(heroV2Level(heroV2Threshold(level+1)-1)).toBe(level);
      expect(heroV2Stats(level).damage).toBeLessThanOrEqual(100);
    }
    expect(heroV2Threshold(52)-heroV2Threshold(51)).toBeGreaterThan(heroV2Threshold(51)-heroV2Threshold(50));
    expect(()=>heroV2Threshold(0)).toThrow();
    expect(()=>heroV2Level(-1)).toThrow();
    expect(()=>heroV2Threshold(Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it('hero defense absorbs only damage and health is bounded',()=>{
    expect(heroV2Hit(61,40,100)).toEqual({hp:1,defense:0,absorbed:40,lostHp:60,killed:false});
    expect(heroV2Hit(100,391,100)).toMatchObject({hp:100,defense:291,killed:false});
    const first=heroV2Hit(100,0,45);
    expect(heroV2Hit(first.hp,first.defense,45)).toMatchObject({hp:10,killed:false});
    expect(heroV2Hit(10,0,45)).toMatchObject({hp:0,killed:true});
    expect(heroV2Hit(0,10,45)).toMatchObject({hp:0,defense:10,killed:false});
  });
  it('only three role codes may shoot',()=>{
    for(const role of ['DON','COMMISSAR','MERGAN'])expect(heroV2CanShoot(role)).toBe(true);
    for(const role of ['MAFIOSO','DOCTOR','CITIZEN','SERIAL_KILLER','FROZEN','ZOMBIE'])expect(heroV2CanShoot(role)).toBe(false);
  });
});
