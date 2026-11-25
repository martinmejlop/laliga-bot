import {spawn} from 'node:child_process';
import {openSync,closeSync,mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),base='http://127.0.0.1:3210';
const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!['--stop','--no-browser'].includes(arg)))throw new Error('Opciones de inicio inválidas.');
async function health(){
  try {const response=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(1500)});if(!response.ok)return null;return await response.json();}catch{return null;}
}
try {
  let current=await health();
  if(current&&current.application!=='laliga-advisor')throw new Error('El puerto del panel está ocupado por otra aplicación.');
  if(args.includes('--stop')){
    if(!current){console.log('El bot de LaLiga ya está detenido.');process.exit(0);}
    const state=await(await fetch(`${base}/api/state`,{signal:AbortSignal.timeout(10000)})).json();
    const response=await fetch(`${base}/api/shutdown`,{method:'POST',headers:{'content-type':'application/json','x-laliga-token':state.csrfToken},body:'{}',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('No se pudo detener el bot.');console.log('Bot de LaLiga detenido.');
  } else {
    if(!current){
      mkdirSync(join(root,'data'),{recursive:true});
      const out=openSync(join(root,'data','server.log'),'a'),err=openSync(join(root,'data','server-error.log'),'a');
      const child=spawn(process.execPath,[join(root,'src','server.ts')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});
      closeSync(out);closeSync(err);child.unref();
      let launchError=null;child.on('error',error=>{launchError=error;});
      for(let attempt=0;attempt<60&&!current;attempt++){
        if(launchError)throw launchError;
        await new Promise(resolve=>setTimeout(resolve,500));current=await health();
      }
      if(!current)throw new Error(`El panel no pudo arrancar. Revisa data/server-error.log. ${readFileSync(join(root,'data','server-error.log'),'utf8').slice(-500)}`);
    }
    console.log(`Panel preparado: ${base}`);
    if(!args.includes('--no-browser')){
      const browser=process.platform==='win32'?spawn('explorer.exe',[base],{windowsHide:true,detached:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[base],{detached:true,stdio:'ignore'});
      browser.on('error',()=>console.log(`Abre ${base} en tu navegador.`));browser.unref();
    }
  }
}catch(error){console.error(`No se pudo completar: ${error.message}`);process.exitCode=1;}
