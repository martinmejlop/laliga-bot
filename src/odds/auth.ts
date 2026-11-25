import {join} from 'node:path';
import {readJson,writeJson} from '../files.ts';
export function providerKey(directory:string):string {
  return process.env.MOVIODDS_API_KEY?.trim() || readJson<{key:string}>(join(directory,'odds-auth.json'),{key:''}).key || '';
}
export function saveProviderKey(directory:string,key:unknown) {
  if(typeof key!=='string'||!key.trim()||key.length>256||!/^[a-zA-Z0-9_.-]+$/.test(key.trim()))throw new Error('Introduce una clave válida del plan gratuito de MoviOdds.');
  writeJson(join(directory,'odds-auth.json'),{key:key.trim()});
}
export function authenticatedOddsRequest(directory:string,request:typeof fetch):typeof fetch {
  return async(input,init)=>{
    const url=new URL(String(input));
    if(url.origin!=='https://moviodds.com')throw new Error('Destino del proveedor no autorizado.');
    const headers=new Headers(init?.headers),key=providerKey(directory);
    if(key)headers.set('X-API-Key',key);
    return request(input,{...init,headers,redirect:'error'});
  };
}
