/** Staging-only offline UI asset preparation. No people/content records or sends. */
import fs from 'node:fs';
import path from 'node:path';
import { resolveWebsiteAiIntegration } from '../src/lib/websiteAiIntegration';
import { AiContentService } from '../src/lib/aiService';

async function main() {
  if (process.env.NODE_ENV !== 'production' || process.env.UI_TRANSLATION_STAGING_ONLY !== 'true') throw new Error('Explicit staging asset-preparation gate required');
  const output=process.env.UI_TRANSLATION_OUTPUT!;
  if (!output?.startsWith('/output/')) throw new Error('Expected isolated output directory');
  const config=await resolveWebsiteAiIntegration();
  if(!config) throw new Error('No configured translation provider');
  const service=new AiContentService({...config,qualityMode:'premium'});
  const tasks: {lang:string;texts:Record<string,string>}[]=JSON.parse(fs.readFileSync('/input/ui-translation-requests.json','utf8'));
  fs.mkdirSync(output,{recursive:true});
  // Resume successful keys from the first pass without spending tokens twice.
  const seedDir='/output/../seed';
  const seeds:Record<string,Record<string,string>>={};
  if(fs.existsSync(seedDir))for(const f of fs.readdirSync(seedDir)){
    const match=/^([a-z]{2})-.+\.json$/.exec(f);if(match)Object.assign(seeds[match[1]]??={},JSON.parse(fs.readFileSync(path.join(seedDir,f),'utf8')));
  }
  for(const task of tasks)for(const key of Object.keys(task.texts))if(seeds[task.lang]?.[key])delete task.texts[key];
  for(const[lang,values]of Object.entries(seeds))fs.writeFileSync(path.join(output,`${lang}-seed.json`),JSON.stringify(values));
  const jobs: {lang:string;texts:Record<string,string>;id:number}[]=[];
  for(const task of tasks){let batch:Record<string,string>={},size=0,index=0;
    for(const [key,value]of Object.entries(task.texts)){if(size+value.length>4200||Object.keys(batch).length>=55){jobs.push({lang:task.lang,texts:batch,id:index++});batch={};size=0;}batch[key]=value;size+=value.length;}
    if(Object.keys(batch).length)jobs.push({lang:task.lang,texts:batch,id:index});
  }
  let next=0,completed=0,failed=0;
  async function worker(){while(next<jobs.length){const job=jobs[next++],file=path.join(output,`${job.lang}-${job.id}.json`);if(fs.existsSync(file)){completed++;continue;}
    for(let attempt=0;attempt<3;attempt++){try{
      const result=await service.translateTextMap({sourceLocale:'English or Turkish (detect per value)',targetLocale:job.lang,texts:job.texts,editorialGuidance:'Translate an education admissions CRM interface, not desktop software. Lead means prospective customer; intake means admission period; agent means recruitment agency partner unless explicitly AI agent; pipeline means work tracking pipeline. Use natural professional UI language. Translate all action labels. Preserve Find And Study brand, code, URLs, examples and ALL {name}, {{name}}, %s and ${name} variables verbatim. Never insert KDE, Qt, @info or translator comments. These strings contain no student or customer data.'});
      const tokens=(s:string)=>[...s.matchAll(/\{[a-zA-Z0-9_]+\}|%s/g)].map(m=>m[0]).sort().join('|');
      for(const [key,value]of Object.entries(result)){if(!value.trim()||tokens(value)!==tokens(job.texts[key])||/@\s*(?:info|action|label)|QDialog|BelizComment|Saytcolor/i.test(value))throw new Error('Invalid translation or interpolation');}
      fs.writeFileSync(file,JSON.stringify(result));completed++;console.log(JSON.stringify({lang:job.lang,batch:job.id,completed,total:jobs.length}));break;
    }catch(error){const message=error instanceof Error?error.message:'';if(attempt===2){failed++;console.log(JSON.stringify({lang:job.lang,batch:job.id,error:/429|rate.limit/i.test(message)?'RATE_LIMIT':/JSON/.test(message)?'INVALID_JSON':/interpolation/.test(message)?'INVALID_PLACEHOLDER':'PROVIDER_ERROR'}));}else await new Promise(r=>setTimeout(r,/429|rate.limit/i.test(message)?30000:(attempt+1)*2000));}}
  }}
  await Promise.all(Array.from({length:24},()=>worker()));
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({completed,failed,total:jobs.length}));
  process.exitCode=failed?1:0;
}
main().catch(()=>{console.error('UI asset translation failed; provider credentials were not logged.');process.exitCode=1;}).finally(()=>setTimeout(()=>process.exit(process.exitCode||0),100));
