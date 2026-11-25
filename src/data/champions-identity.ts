import {readFileSync} from 'node:fs';
const key=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[.]/g,'').replace(/\s+/g,' ').trim();
const teams:{name:string;aliases:string[]}[]=JSON.parse(readFileSync(new URL('../../config/champions-teams.json',import.meta.url),'utf8')).teams;
const aliases=new Map<string,string>();
for(const team of teams)for(const name of [team.name,...team.aliases]){const previous=aliases.get(key(name));if(previous&&previous!==team.name)throw Error('Alias de Champions ambiguo.');aliases.set(key(name),team.name);}
export function championsTeamName(name:unknown):string|null{return typeof name==='string'?aliases.get(key(name))??null:null;}
export function championsTeamsInText(text:string):string[]{const normalized=' '+key(text).replace(/[^\p{L}\p{N}]+/gu,' ')+' ';return teams.filter(team=>[team.name,...team.aliases].some(a=>a.length>=4&&normalized.includes(' '+key(a).replace(/[^\p{L}\p{N}]+/gu,' ')+' '))).map(t=>t.name);}
