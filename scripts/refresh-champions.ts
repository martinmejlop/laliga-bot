import {join} from 'node:path';
import {ROOT} from '../src/config.ts';
import {refreshChampionsData} from '../src/data/champions-service.ts';
import {evaluateModel,fitModel} from '../src/model/service.ts';
import {writeJson} from '../src/files.ts';
const directory=join(ROOT,'data'),snapshot=await refreshChampionsData(directory),evaluation=evaluateModel(snapshot.matches),model=fitModel(snapshot.matches,Date.now(),evaluation.selectedOptions);
writeJson(join(directory,'champions-evaluation-preview.json'),evaluation);writeJson(join(directory,'champions-model-preview.json'),model);
console.log(JSON.stringify({matches:snapshot.matches.length,scored:snapshot.matches.filter(m=>m.status==='finished').length,errors:snapshot.errors,coverage:snapshot.coverage.map(c=>({source:c.source,season:c.season,scored:c.scored,missing:c.missingPastResults})),model:model.status,test:evaluation.test,passed:Object.fromEntries(Object.entries(evaluation.marketGates).map(([k,v])=>[k,v?.selections.filter(s=>s.passed).map(s=>({side:s.side,line:s.line}))]))},null,2));
