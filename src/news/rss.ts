import { createHash } from 'node:crypto';
import type { NewsItem } from '../domain.ts';
import { teamsInText } from '../data/identity.ts';

function decode(value:string):string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(_m,n)=> {const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return Number.isSafeInteger(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):'';})
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_m,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]!);
}
export function plainText(value:string):string {
  return decode(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}
const field=(xml:string,name:string)=>xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]?.trim()??'';
function canonicalUrl(raw:string):string {
  const url=new URL(decode(raw));
  if (url.protocol!=='https:'||url.username||url.password||!/(^|\.)mundodeportivo\.com$/i.test(url.hostname)) throw new Error('URL RSS fuera de la fuente seleccionada.');
  url.hash='';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(key)) url.searchParams.delete(key);
  return url.href;
}
export function parseRss(raw:string,receivedAt:number,captureId:string): {news:NewsItem[];warnings:string[]} {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)||!/<rss\b|<rdf:RDF\b/i.test(raw)) throw new Error('Formato RSS no admitido.');
  const blocks=[...raw.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (!blocks.length) throw new Error('RSS sin noticias.');
  const news:NewsItem[]=[];const warnings:string[]=[];const urls=new Set<string>();const content=new Map<string,string>();
  for (const match of blocks.slice(0,100)) {
    try {
      const xml=match[1],title=plainText(field(xml,'title')).slice(0,500),url=canonicalUrl(field(xml,'link'));
      if (!title||urls.has(url)) continue; urls.add(url);
      const rawDate=plainText(field(xml,'pubDate'));
      const date=rawDate?Date.parse(rawDate):NaN;
      const publishedAt=Number.isFinite(date)?date:null;
      if (publishedAt!==null&&publishedAt>receivedAt) throw new Error('Fecha de publicación futura.');
      if (publishedAt===null) warnings.push(`Noticia sin fecha verificable: ${url}`);
      // Solo titular/resumen RSS, nunca content:encoded ni descarga del artículo completo.
      const description=plainText(field(xml,'description')).slice(0,500);
      const text=description&&description!==title?description:'';
      const id=`md:${createHash('sha256').update(url).digest('hex').slice(0,24)}`;
      const key=plainText(`${title} ${text}`).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('es').replace(/\W+/g,' ').trim();
      const duplicateOf=content.get(key);if (!duplicateOf)content.set(key,id);
      news.push({id,title,text,url,source:'mundodeportivo:rss',publishedAt,receivedAt,captureId,
        teams:teamsInText(`${title} ${text}`),scope:text?'excerpt':'metadata',...(duplicateOf?{duplicateOf}:{})});
    } catch(error) { warnings.push(`Entrada RSS omitida: ${error instanceof Error?error.message:'incompatible'}`); }
  }
  return {news:news.sort((a,b)=>(b.publishedAt??0)-(a.publishedAt??0)),warnings};
}
