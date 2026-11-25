import { readFileSync } from 'node:fs';

const key = (value: string) => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('es').replace(/[.]/g,'').replace(/\s+/g,' ').trim();
export const TEAM_CATALOG: {name:string; aliases:string[]; espn?:string[]}[] = JSON.parse(readFileSync(new URL('../../config/history-aliases.json',import.meta.url),'utf8')).teams;
const mapping = new Map<string,string>();
for (const team of TEAM_CATALOG) {
  for (const alias of [team.name,...team.aliases,...(team.espn??[])]) {
    const previous = mapping.get(key(alias));
    if (previous && previous!==team.name) throw new Error('Catálogo de nombres ambiguo.');
    mapping.set(key(alias),team.name);
  }
}
export function canonicalTeamName(alias: string): string | null {
  return typeof alias==='string' ? mapping.get(key(alias))??null : null;
}
export function teamsInText(text: string): string[] {
  const normalized = ` ${key(text).replace(/[^\p{L}\p{N}]+/gu,' ')} `;
  return TEAM_CATALOG.filter(team => [team.name,...team.aliases].some(alias => {
    const needle = key(alias).replace(/[^\p{L}\p{N}]+/gu,' ');
    return needle.length>=4 && normalized.includes(` ${needle} `);
  })).map(team => team.name);
}
