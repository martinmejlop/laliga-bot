import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export function readJson<T>(path:string,fallback:T):T { return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):fallback; }
export function writeJson(path:string,value:unknown) {
  mkdirSync(dirname(path),{recursive:true});
  const temporary=`${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary,JSON.stringify(value,null,2)+'\n','utf8'); renameSync(temporary,path);
}
