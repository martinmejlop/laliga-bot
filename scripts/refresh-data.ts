import { refreshData } from '../src/data/service.ts';
const args=process.argv.slice(2);
if(args.some(x=>!['--offline','--no-ai'].includes(x)))throw new Error('Uso: refresh-data.ts [--offline] [--no-ai]');
const snapshot=await refreshData({network:!args.includes('--offline'),analyzeNews:!args.includes('--no-ai')});
console.log(JSON.stringify({updatedAt:new Date(snapshot.updatedAt).toISOString(),matches:snapshot.matches.length,
  scored:snapshot.matches.filter(row=>row.status==='finished').length,news:snapshot.news.length,newsAnalysis:snapshot.newsAnalysis,
  coverage:snapshot.coverage,errors:snapshot.errors},null,2));
