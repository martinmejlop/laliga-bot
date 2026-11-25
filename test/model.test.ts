import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitModel,predictMatch,scoreDistribution,resultKnownAfter,evaluateModel,marketGateFor } from '../src/model/service.ts';
import type { HistoricalMatch } from '../src/domain.ts';

const DAY=86400000;
function controlledSeasons(count=6):HistoricalMatch[]{
  let state=14871;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)|0;return (state>>>0)/4294967296;};
  const goals=(mean:number)=>{const threshold=Math.exp(-mean);let p=1,n=0;do{n++;p*=random();}while(p>threshold);return n-1;};
  const result:HistoricalMatch[]=[];
  for(let season=0;season<count;season++){
    let index=0;
    for(let home=0;home<8;home++)for(let away=0;away<8;away++)if(home!==away){
      const time=Date.UTC(2018+season,7,1)+index*2*DAY,date=new Date(time).toISOString().slice(0,10);
      result.push({id:`${season}-${home}-${away}`,season:`${2018+season}-${String(2019+season).slice(-2)}`,date,kickoffAt:null,
        home:`Equipo ${home}`,away:`Equipo ${away}`,homeGoals:goals(1.4*Math.exp((home-away)/15)),awayGoals:goals(1.0*Math.exp((away-home)/15)),status:'finished',source:'controlled',captureId:`capture-${season}`,availableAt:time+DAY});index++;
    }
  }
  return result;
}
test('El ajuste y las variables no cambian al modificar resultados posteriores al corte',()=>{
  const rows=controlledSeasons(),cutoff=Date.UTC(2022,0,1);
  const changed=rows.map(r=>Date.parse(r.date)>=cutoff?{...r,homeGoals:99,awayGoals:99}:r);
  const first=fitModel(rows,cutoff),second=fitModel(changed,cutoff);
  assert.deepEqual(first,second);
  const prediction=predictMatch(first,'Equipo 0','Equipo 7',cutoff+DAY);
  assert.deepEqual(prediction,predictMatch(second,'Equipo 0','Equipo 7',cutoff+DAY));
  assert.equal(prediction.features.home.injuries,null);assert.equal(prediction.features.home.xG,null);
  assert.ok(prediction.features.home.restDays!>=0);
});
test('Sin hora conocida no se utiliza un resultado del mismo día y se respeta recepción observada',()=>{
  const row=controlledSeasons(1)[0];
  const at=Date.parse(`${row.date}T00:00:00Z`);
  assert.equal(resultKnownAfter(row),at+DAY);
  assert.equal(fitModel([row],at+12*3600000).trainingMatches,0);
  assert.equal(fitModel([row],at+DAY+1).trainingMatches,1);
  const late={...row,availableAt:Date.UTC(2026,10,15)};
  assert.equal(fitModel([late],at+DAY+1).trainingMatches,0);
  const reconstructed=fitModel([late],at+DAY+1,{availability:'reconstructed'});
  assert.equal(reconstructed.trainingMatches,1);assert.ok(reconstructed.warnings.some(x=>/Reconstrucción/.test(x)));
});
test('La distribución corregida conserva positividad, normalización y una cola truncada explícita',()=>{
  for(const [home,away,rho] of [[1.5,1,-.1],[5,5,.12],[.2,4,-.18]]){
    const result=scoreDistribution(home,away,rho);
    assert.ok(result.matrix.flat().every(x=>Number.isFinite(x)&&x>=0));
    assert.ok(Math.abs(result.matrix.flat().reduce((a,b)=>a+b,0)-1)<1e-12);
    assert.ok(result.omittedTailMass>=0&&result.omittedTailMass<.001);
  }
  assert.throws(()=>scoreDistribution(-1,2));
});
test('Un equipo sin historia recibe la media de la liga y una advertencia, no certeza inventada',()=>{
  const rows=controlledSeasons(),cutoff=Date.UTC(2024,0,1),model=fitModel(rows,cutoff);
  const p=predictMatch(model,'Ascendido','Equipo 0',cutoff+DAY);
  assert.equal(p.features.home.matches,0);assert.equal(p.features.home.attackStrength,1);
  assert.equal(p.features.home.sparseHistory,true);assert.equal(p.ready,false);
  assert.equal(p.features.home.formPointsPerGame,null);assert.equal(p.features.home.restDays,null);
  assert.ok(Math.abs(p.probabilities.home+p.probabilities.draw+p.probabilities.away-1)<1e-12);
});
test('Cambiar la prueba final no altera la selección de parámetros ni las métricas de validación',()=>{
  const rows=controlledSeasons(8),now=Date.UTC(2026,0,1);
  const original=evaluateModel(rows,{now,minTraining:100});
  assert.equal(original.status,'evaluated');
  const altered=rows.map(r=>r.date>=original.chronology.testStart!?{...r,homeGoals:0,awayGoals:7}:r);
  const second=evaluateModel(altered,{now,minTraining:100});
  assert.deepEqual(original.selectedOptions,second.selectedOptions);
  assert.deepEqual(original.validation,second.validation);
  assert.notEqual(original.test!.logLoss,second.test!.logLoss);
  assert.ok(original.chronology.trainEnd!<original.chronology.validationStart!);
  assert.ok(original.chronology.validationEnd!<original.chronology.testStart!);
  assert.equal(original.test!.calibration.reduce((a,b)=>a+b.count,0),3*original.test!.sampleSize);
  assert.equal(original.roi,null);assert.ok(original.limitations.some(x=>/Sin cuotas históricas/.test(x)));
  assert.ok(marketGateFor(original,{kind:'asian_handicap',side:'home',line:.25}));
  assert.equal(marketGateFor(original,{kind:'asian_handicap',side:'home',line:1.25}),null);
  assert.equal(marketGateFor(original,{kind:'team_goals',side:'over',line:1.5}),null);
  assert.ok(marketGateFor(original,{kind:'team_goals',side:'over',line:1.5,team:'home'}));
  assert.ok(Object.values(original.marketGates).every(g=>g.sampleSize===original.test!.sampleSize));
});
test('La evaluación insuficiente se abstiene y un histórico contradictorio se rechaza',()=>{
  const rows=controlledSeasons(1);
  assert.equal(evaluateModel(rows).status,'insufficient');
  assert.equal(evaluateModel(rows).modelGate.passed,false);
  assert.throws(()=>fitModel([rows[0],{...rows[0],id:'contradiction',homeGoals:rows[0].homeGoals!+1}],Date.UTC(2020,0,1)),/contradictorios/);
});
