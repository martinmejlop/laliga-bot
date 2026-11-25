import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Runtime,type RuntimeOptions} from './runtime.ts';
import {renderReport} from './report.ts';
import {assertRuntime} from './config.ts';

function send(response:ServerResponse,status:number,value:any,type='application/json; charset=utf-8') {
  response.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  response.end(type.startsWith('application/json')?JSON.stringify(value):value);
}
async function body(request:IncomingMessage) {
  if(Number(request.headers['content-length'])>64000)throw new Error('Formulario demasiado grande.');
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of request){size+=chunk.length;if(size>64000)throw new Error('Formulario demasiado grande.');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  if(!value || Array.isArray(value)||typeof value!=='object')throw new Error('Formulario inválido.');return value;
}
export function createApplication(options:RuntimeOptions={}) {
  assertRuntime();const runtime=new Runtime(options);
  const server=createServer(async(request,response)=>{
    try {
      const host=request.headers.host??'';
      if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))return send(response,403,{error:'Acceso limitado al panel local.'});
      const url=new URL(request.url??'/',`http://${host}`);
      if(request.method==='GET'){
        if(url.pathname==='/api/health')return send(response,200,{ok:true,application:'laliga-advisor',pid:process.pid});
        if(url.pathname==='/api/state')return send(response,200,runtime.state(url.searchParams.get('focus')??''));
        if(url.pathname==='/reports/latest.html')return send(response,200,renderReport(runtime.report()),'text/html; charset=utf-8');
        const assets:any={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
        const asset=assets[url.pathname];
        if(asset)return send(response,200,readFileSync(new URL(`./ui/${asset[0]}`,import.meta.url),'utf8'),asset[1]);
        return send(response,404,{error:'Página desconocida.'});
      }
      if(request.method!=='POST')return send(response,405,{error:'Método no admitido.'});
      if(request.headers['x-laliga-token']!==runtime.csrfToken || request.headers.origin && request.headers.origin!==`http://${host}` || !String(request.headers['content-type']??'').startsWith('application/json'))return send(response,403,{error:'Recarga el panel local antes de guardar cambios.'});
      const input=await body(request);
      if(url.pathname==='/api/shutdown'){
        send(response,200,{message:'Bot detenido.'});runtime.close();server.close();return;
      }
      const result=await runtime.mutate(url.pathname,input);send(response,200,result??{ok:true});
    }catch(error){send(response,400,{error:error instanceof Error?error.message:'No se pudo completar la operación.'});}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  server.on('close',()=>runtime.close());
  return {server,runtime};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  const {server,runtime}=createApplication();
  server.on('error',error=>{console.error(`No se pudo abrir el panel: ${error.message}`);runtime.close();process.exitCode=1;});
  server.listen(3210,'127.0.0.1',()=>{console.log('Panel de LaLiga: http://127.0.0.1:3210');runtime.start();});
  const close=()=>{runtime.close();server.close();};process.on('SIGINT',close);process.on('SIGTERM',close);
}
