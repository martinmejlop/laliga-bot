import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveProviderKey,authenticatedOddsRequest} from '../src/odds/auth.ts';
test('La clave se añade como cabecera solo al proveedor y no viaja en la URL',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'laliga-auth-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 assert.throws(()=>saveProviderKey(dir,'invalid\nheader'));saveProviderKey(dir,'test_free_key');let calls=0;
 const request=authenticatedOddsRequest(dir,async(url,init)=>{calls++;assert.equal(String(url),'https://moviodds.com/quotes?fi=test&site=com');assert.equal(new Headers(init?.headers).get('x-api-key'),process.env.MOVIODDS_API_KEY?.trim()||'test_free_key');assert.equal(init?.redirect,'error');return new Response('{}');});
 await request('https://moviodds.com/quotes?fi=test&site=com');await assert.rejects(request('https://other.example/'));assert.equal(calls,1);
});
