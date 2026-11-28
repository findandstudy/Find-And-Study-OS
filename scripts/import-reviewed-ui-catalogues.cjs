const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const file=process.argv[2];if(!file)throw Error('Pass the SHA-256 verified staging translation artifact');
const payload=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(payload.schemaVersion,1);assert.match(payload.sourceCommit,/^[a-f0-9]{40}$/);
const dir=path.resolve(__dirname,'../artifacts/edcons/src/lib/i18n/translations'),languages=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)).sort();assert.deepEqual(Object.keys(payload.catalogues).sort(),languages);
function flatten(o,p='',r={}){assert.ok(o&&typeof o==='object'&&!Array.isArray(o));for(const[k,v]of Object.entries(o)){if(v&&typeof v==='object')flatten(v,p+k+'.',r);else{assert.equal(typeof v,'string');assert.ok(v.trim(),p+k);r[p+k]=v;}}return r;}
const expected=Object.keys(flatten(payload.catalogues.en)).sort();
for(const lang of languages){const values=flatten(payload.catalogues[lang]);for(const key of expected)assert.ok(Object.hasOwn(values,key),`${lang}:${key}`);}
for(const lang of languages)fs.writeFileSync(path.join(dir,lang+'.json'),JSON.stringify(payload.catalogues[lang],null,2)+'\n');
fs.writeFileSync(path.resolve(__dirname,'../reports/ui-localization-repair-counts.json'),JSON.stringify(payload.counts,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:payload.sourceCommit,languages:languages.length,keysPerLocale:expected.length,reviewed:Object.values(payload.counts).reduce((n,v)=>n+v.reviewed,0),changed:Object.values(payload.counts).reduce((n,v)=>n+v.changed,0)}));
