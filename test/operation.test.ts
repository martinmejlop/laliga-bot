import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recommendationReadiness,LIVE_REQUIRED_CHECKS} from '../src/operation.ts';
test('La recomendación actual exige todos los controles operativos y conserva la evidencia histórica pendiente',()=>{
 const checks=LIVE_REQUIRED_CHECKS.map(id=>({id,passed:true}));
 const state=recommendationReadiness({checks:[...checks,{id:'real-suspensions',passed:false,detail:'Pendiente de observación real.'}]});
 assert.equal(state.ready,true);assert.equal(state.pendingEvidence.length,1);
 for(const id of LIVE_REQUIRED_CHECKS){assert.equal(recommendationReadiness({checks:checks.filter(c=>c.id!==id)}).ready,false);assert.equal(recommendationReadiness({checks:checks.map(c=>({...c,passed:c.id!==id}))}).ready,false);}
 assert.equal(recommendationReadiness(null).ready,false);assert.equal(recommendationReadiness({checks:[...checks,checks[0]]}).ready,false);
});
