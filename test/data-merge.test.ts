import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeMatchObservations} from '../src/data/service.ts';
import type {HistoricalMatch} from '../src/domain.ts';
const row:HistoricalMatch={id:'isolated-match',season:'2026-27',date:'2026-10-10',kickoffAt:null,home:'Rayo Vallecano de Madrid',away:'Athletic Club',homeGoals:null,awayGoals:null,status:'scheduled',source:'openfootball',captureId:'isolated-capture',availableAt:2000};
test('Refrescar un calendario no revoca una suspensión oficial archivada con anterioridad',()=>{
  const official={...row,date:'2026-12-09',status:'postponed' as const,source:'official:status-review',availableAt:1000};
  for(const rows of [[row,official],[official,row]]){
    const result=mergeMatchObservations(rows,'2026-11-15');assert.equal(result.matches.length,1);assert.equal(result.matches[0].status,'postponed');assert.equal(result.matches[0].date,'2026-12-09');assert.equal(result.matches[0].homeGoals,null);
  }
});
test('Un resultado final posterior sustituye el aplazamiento sin inventar marcadores previos',()=>{
  const official={...row,date:'2026-12-09',status:'postponed' as const,source:'official:status-review',availableAt:1000};
  const final={...row,date:'2026-12-09',status:'finished' as const,homeGoals:1,awayGoals:1,source:'espn-experimental',availableAt:3000};
  for(const rows of [[official,final],[final,official]]){const result=mergeMatchObservations(rows,'2026-12-10');assert.equal(result.matches[0].status,'finished');assert.equal(result.matches[0].homeGoals,1);}
});
