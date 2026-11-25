import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparePublicMarkets} from '../src/odds/public-comparison.ts';
const now=Date.UTC(2026,10,23,12),iso=(t:number)=>new Date(t).toISOString();
function input(){
 const event={id:'123',home:'Barcelona',away:'Real Madrid',kickoffAt:now+86400000};
 const proof={url:'https://www.bet365.es/#/AC/B1/C1/D8/E123/F3/G40/',checkedAt:now-600,text:'- navigation:\n  - generic: Levante v Elche\n- main:\n  - generic: Barcelona v Real Madrid\n  - generic: 24 nov 13:00\n',blocks:[
 {heading:'Resultado final',text:'Resultado final\nCA\nBarcelona\n2.10\nEmpate\n3.60\nReal Madrid\n3.25'},
 {heading:'Doble oportunidad',text:'Doble oportunidad\nCA\nBarcelona o Empate\n1.33\nEmpate o Real Madrid\n1.70\nBarcelona o Real Madrid\n1.28'},
 {heading:'Resultado sin empate',text:'Resultado sin empate\nBarcelona\n1.57\nReal Madrid\n2.25'}]};
 const quotes=[['40','Barcelona','1',2.1],['40','Draw','X',3.6],['40','Real Madrid','2',3.25],['10114','Barcelona or Draw','1X',4/3],['10114','Draw or Real Madrid','X2',1.7],['10114','Barcelona or Real Madrid','12',9/7],['10544','Barcelona','',11/7],['10544','Real Madrid','',2.25]].map(([group_id,label,n2,odds_dec],i)=>({fixture_id:'123',sel_id:String(i),market_id:String(group_id),group_id,label,n2,odds_dec,ts:iso(now-1000)}));
 const raw={site:'com',source:'cache',fixture:'123',count:8,dropped:0,server_time:iso(now-700),group_status:Object.fromEntries(['40','10114','10544'].map(g=>[g,{polled_at:iso(now-750)}])),quotes};
 const capture={url:'https://moviodds.com/quotes?fi=123&site=com',requestedAt:now-800,receivedAt:now-500,raw:JSON.stringify(raw)};
 return {event,proof,capture,raw};
}
test('El contraste exige el encabezado del partido dentro del contenido principal y respeta el redondeo decimal',()=>{
 const {event,proof,capture}=input(),result=comparePublicMarkets(proof,capture,event,now);
 assert.equal(result.coverage.length,3);assert.equal(result.coverage.reduce((n,e)=>n+e.selections.length,0),8);
 assert.equal(result.coverage[2].selections[0].displayPrice,1.57);
 proof.text=proof.text.replace('generic: Barcelona v Real Madrid','generic: Barcelona v Valencia');assert.throws(()=>comparePublicMarkets(proof,capture,event,now),/equipos/);
});
test('Una discrepancia real no se disfraza de redondeo y excluye todo ese mercado',()=>{
 const {event,proof,capture}=input();proof.blocks[2].text=proof.blocks[2].text.replace('1.57','1.65');
 const result=comparePublicMarkets(proof,capture,event,now);assert.equal(result.coverage.length,2);assert.equal(result.comparisons[2].matched,false);
});
test('No se admite un contraste con otro evento, lecturas separadas ni una respuesta parcial',()=>{
 const {event,proof,capture,raw}=input();
 assert.throws(()=>comparePublicMarkets({...proof,checkedAt:now-90000},capture,event,now),/contemporánea/);
 assert.throws(()=>comparePublicMarkets({...proof,url:proof.url.replace('123','456')},capture,event,now),/identidad/);
 assert.throws(()=>comparePublicMarkets(proof,{...capture,raw:JSON.stringify({...raw,dropped:1})},event,now),/completa/);
});
test('Cuotas suspendidas o con tiempos incoherentes no generan un perfil español aprobado',()=>{
 const {event,proof,capture,raw}=input();Object.assign(raw.quotes[0],{suspended:true});
 assert.equal(comparePublicMarkets(proof,{...capture,raw:JSON.stringify(raw)},event,now).comparisons[0].matched,false);
 delete (raw.quotes[0] as any).suspended;raw.quotes[0].ts=iso(now+1000);
 assert.equal(comparePublicMarkets(proof,{...capture,raw:JSON.stringify(raw)},event,now).comparisons[0].matched,false);
});
test('Un contraste de Champions identifica su competición y admite los nombres ingleses equivalentes observados en Bet365 España',()=>{
 const {event,proof,capture}=input();proof.text=proof.text.replace('- main:\n','- main:\n  - generic: UEFA Champions League\n');
 const names={'Resultado final':'Full Time Result','Doble oportunidad':'Double Chance','Resultado sin empate':'Draw No Bet'};
 proof.blocks=proof.blocks.map(b=>({...b,displayHeading:names[b.heading],text:b.text.replace(b.heading,names[b.heading]).replaceAll('Empate','Draw').replaceAll(' o ',' or ')}));
 const result=comparePublicMarkets(proof,capture,{...event,competition:'Champions'},now);assert.equal(result.coverage.length,3);assert.ok(result.coverage.every(e=>e.competition==='Champions'));
 proof.text=proof.text.replace('  - generic: UEFA Champions League\n','');assert.throws(()=>comparePublicMarkets(proof,capture,{...event,competition:'Champions'},now),/identifica/);
});
