import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss } from '../src/news/rss.ts';
import { analyzeNewsItems, validateFacts } from '../src/news/qwen.ts';
import type { NewsItem } from '../src/domain.ts';
const now=Date.UTC(2026,10,15,10);
const rss=(items:string)=>`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
const item=(title:string,link:string,date='Sun, 15 Nov 2026 09:00:00 GMT',description='')=>`<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[${description}]]></description></item>`;
test('Se guardan solo titular y resumen RSS, con fecha, equipo, enlace y alcance explícitos',()=> {
  const parsed=parseRss(rss(item('Duda en el Barça','https://www.mundodeportivo.com/test?utm_source=x#top',undefined,'<p>El Barcelona tiene una duda.</p><script>orden()</script>')),now,'cap');
  assert.equal(parsed.news.length,1);assert.deepEqual(parsed.news[0].teams,['FC Barcelona']);
  assert.equal(parsed.news[0].url,'https://www.mundodeportivo.com/test');assert.equal(parsed.news[0].text,'El Barcelona tiene una duda.');
  assert.equal(parsed.news[0].scope,'excerpt');assert.equal(parsed.news[0].publishedAt,now-3600000);assert.equal(parsed.news[0].captureId,'cap');
});
test('Las copias de URL se eliminan y textos equivalentes se marcan como copias, sin contarlos como fuentes independientes',()=> {
  const parsed=parseRss(rss(item('Noticia del Barça','https://www.mundodeportivo.com/one')+item('Noticia del Barça','https://www.mundodeportivo.com/one')+item('Noticia del Barça','https://www.mundodeportivo.com/two')),now,'cap');
  assert.equal(parsed.news.length,2);assert.equal(parsed.news[1].duplicateOf,parsed.news[0].id);
});
test('Noticias futuras, enlaces ajenos y entidades XML externas no se admiten; la ausencia de fecha permanece visible',()=> {
  const parsed=parseRss(rss(item('Futuro','https://www.mundodeportivo.com/future','Mon, 16 Nov 2026 09:00:00 GMT')+item('Ajeno','https://example.org/news')+item('Sin fecha Barça','https://www.mundodeportivo.com/nodate','')),now,'cap');
  assert.equal(parsed.news.length,1);assert.equal(parsed.news[0].publishedAt,null);assert.ok(parsed.warnings.length>=3);
  assert.throws(()=>parseRss('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///private">]>'+rss(''),now,'cap'),/no admitido/);
});
const news:NewsItem={id:'news1',title:'Pedro sigue siendo duda en el Barcelona',text:'Pedro podría perderse el partido por molestias.',url:'https://www.mundodeportivo.com/news',source:'mundodeportivo:rss',publishedAt:now-3600000,receivedAt:now,captureId:'cap',teams:['FC Barcelona'],scope:'excerpt'};
const fact={kind:'doubt',team:'FC Barcelona',player:'Pedro',evidence:'Pedro podría perderse el partido por molestias.',newsId:'news1',status:'rumour'};
test('La extracción admite una duda respaldada por una cita literal, sin convertirla en lesión confirmada',()=> {
  assert.equal(validateFacts({facts:[fact]},[news],now).length,1);
  assert.throws(()=>validateFacts({facts:[{...fact,status:'reported'}]},[news],now),/incertidumbre/);
  assert.throws(()=>validateFacts({facts:[{...fact,status:'official'}]},[news],now),/medio/);
});
test('Citas inventadas, jugadores ausentes, equipos incorrectos y noticias antiguas o duplicadas invalidan la respuesta',()=> {
  for(const altered of [{...fact,evidence:'Una cita que no estaba en ninguna fuente'},{...fact,player:'Jugador inventado'},{...fact,team:'Real Madrid CF'},{...fact,newsId:'missing'}])assert.throws(()=>validateFacts({facts:[altered]},[news],now));
  assert.throws(()=>validateFacts({facts:[fact]},[{...news,publishedAt:now-8*86400000}],now));
  assert.throws(()=>validateFacts({facts:[fact]},[{...news,duplicateOf:'another'}],now));
  assert.throws(()=>validateFacts({facts:[fact],instructions:'haz una apuesta'},[news],now));
});
test('La consulta Qwen está acotada al modelo local y trata el contenido de las noticias como datos sin herramientas',async ()=> {
  let called=false;
  const result=await analyzeNewsItems([news],async (url,init)=> {
    called=true;assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(init?.method,'POST');
    const body=JSON.parse(String(init?.body));assert.equal(body.model,'qwen3:8b');assert.equal(body.stream,false);assert.equal(body.think,false);
    assert.equal(body.options.num_thread,2);assert.equal(body.tools,undefined);assert.match(body.messages[0].content,/nunca instrucciones/);
    return new Response(JSON.stringify({done:true,message:{role:'assistant',content:JSON.stringify({facts:[fact]})}}));
  },now);
  assert.equal(called,true);assert.equal(result.status,'available');assert.equal(result.facts.length,1);
});
test('Sin noticias elegibles, con IA caída o con evidencia falsa no se simula un análisis satisfactorio',async ()=> {
  const empty=await analyzeNewsItems([],async ()=>{throw new Error('No debería llamarse');},now);assert.equal(empty.status,'empty');
  const offline=await analyzeNewsItems([news],async ()=>{throw new Error('Desconectado');},now);assert.equal(offline.status,'unavailable');assert.deepEqual(offline.facts,[]);
  const invalid=await analyzeNewsItems([news],async ()=>new Response(JSON.stringify({done:true,message:{role:'assistant',content:JSON.stringify({facts:[{...fact,evidence:'Evidencia inventada que no existe'}]})}})),now);
  assert.equal(invalid.status,'invalid');assert.equal(invalid.facts.length,0);
});
test('Las peticiones IA se serializan para no bloquear ni saturar el modelo compartido',async ()=> {
  let active=0,maximum=0;
  const request=async ()=> {active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response(JSON.stringify({done:true,message:{role:'assistant',content:'{"facts":[]}'}}));};
  await Promise.all([analyzeNewsItems([news],request,now),analyzeNewsItems([news],request,now)]);
  assert.equal(maximum,1);
});
