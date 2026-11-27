import { normalizeEmbedEnquiryMessage } from "../../api-server/src/lib/embedEnquiryMessage";
import { getEmbedLeadFormCopy } from "../../api-server/src/lib/embedLeadFormI18n";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canIssueFirstPartyEmbedToken } from '../../api-server/src/lib/firstPartyEmbedPolicy';
import { filterCountryDirectory,type PublicCountryItem } from '../src/lib/website/countryDirectory';
import { capitalizePageLabel,sharedPageHeaderBlocks } from '../src/lib/website/pageHeader';
import { renderReusableEditorial } from '../../api-server/src/lib/reusableEditorialRender';
import type { PageBlock } from '../src/lib/website/blockTypes';
const request={origin:'https://staging.findandstudy.com',referer:'https://staging.findandstudy.com/en/contact',fetchSite:'same-origin',mode:'lead_form',agentId:null,domains:['staging.findandstudy.com']};
test('website embed exchange requires an explicitly allowed first-party public form',()=>{
 assert.equal(canIssueFirstPartyEmbedToken(request),true);
 for(const change of [{referer:undefined},{referer:'https://evil.test/contact'},{fetchSite:'same-site'},{fetchSite:undefined},{mode:'application'},{agentId:2},{domains:[]},{domains:['evil.test']},{origin:'file:///tmp/site'}])assert.equal(canIssueFirstPartyEmbedToken({...request,...change}),false,JSON.stringify(change));
});
const countries:PublicCountryItem[]=Array.from({length:19},(_,i)=>({id:i+1,name:i===0?'Türkiye':'Country '+i,country:i===0?'Turkey':'Country '+i,canonicalPath:'',universityCount:i===0?0:i,programCount:i===0?0:i*3,isFeatured:false}));
test('all active country results retain zero-program entries and are never capped to six',()=>{
 const before=structuredClone(countries);assert.equal(filterCountryDirectory(countries,{search:'',availability:'all',sort:'az'}).length,19);assert.deepEqual(countries,before);
 assert.equal(filterCountryDirectory(countries,{search:'Turkiye',availability:'all',sort:'az'})[0].name,'Türkiye');
 assert.equal(filterCountryDirectory(countries,{search:'',availability:'programs',sort:'programs'})[0].programCount,54);
 assert.equal(filterCountryDirectory(countries,{search:'',availability:'universities',sort:'az'}).length,18);
});
test('common page header preserves content/settings and uses locale-aware initial capitals',()=>{
 assert.equal(capitalizePageLabel(' iletişim ','tr'),'İletişim');assert.equal(capitalizePageLabel('AI services'),'AI services');
 const source:PageBlock[]=[{blockType:'hero',content:{title:'countries',subtitle:'Preserved'},settings:{sectionPadding:35},sortOrder:0,isVisible:true},{blockType:'rich_text',content:{title:'Body'},settings:{},sortOrder:1,isVisible:true}];
 const before=structuredClone(source),result=sharedPageHeaderBlocks(source,'Countries','en');assert.deepEqual(source,before);assert.deepEqual(result[1],source[1]);assert.deepEqual(result[0].settings,source[0].settings);assert.equal(result[0].content.subtitle,'Preserved');assert.equal(result[0].content.variant,'about-banner');assert.deepEqual(sharedPageHeaderBlocks(result,'Countries','en'),result);
 const html=renderReusableEditorial(result[0].content,{escape:s=>s.replaceAll('<','&lt;').replaceAll('"','&quot;'),url:v=>typeof v==='string'?v:null,image:v=>typeof v==='string'?v:null})!;assert.match(html,/public-page-header/);assert.match(html,/aria-current="page">Countries/);
});
test('About and Contact use the system embed renderer; editor preview cannot submit',()=>{
 const root=new URL('../src/pages/public/',import.meta.url);for(const file of ['Contact.tsx','EditorialInquiryForm.tsx']){const source=readFileSync(new URL(file,root),'utf8');assert.match(source,/<EmbeddedLeadForm/);assert.doesNotMatch(source,/website-forms|onSubmit/);assert.ok(!source.includes('/api/public/lead'));}
 const source=readFileSync(new URL('EmbeddedLeadForm.tsx',root),'utf8');assert.ok(source.includes('if(preview)return'));assert.match(source,/event.origin!==location.origin/);assert.match(source,/event.source!==frame.current/);assert.match(source,/website-token/);
});

test('embed enquiry messages preserve paragraphs, bound input and use local labels',()=>{
 assert.equal(normalizeEmbedEnquiryMessage('  First\r\n\r\nSecond  '),'First\n\nSecond');assert.equal(normalizeEmbedEnquiryMessage('   '),null);assert.equal(normalizeEmbedEnquiryMessage({message:'wrong shape'}),null);assert.equal(normalizeEmbedEnquiryMessage('x'.repeat(5001))?.length,5000);assert.equal(normalizeEmbedEnquiryMessage('A\u0000B'),'AB');assert.equal(getEmbedLeadFormCopy('tr').message,'Mesaj');assert.equal(getEmbedLeadFormCopy('ar').message,'الرسالة');
});

test('program directory follows its header in every locale without dropping editorial blocks',()=>{
 const source:PageBlock[]=[{blockType:'hero',content:{title:'Programs'},settings:{},sortOrder:0,isVisible:true},{blockType:'progress_bars',content:{title:'Introduction'},settings:{},sortOrder:1,isVisible:true},{blockType:'catalog_grid',content:{source:'programs'},settings:{},sortOrder:2,isVisible:true},{blockType:'cta_banner',content:{title:'Help'},settings:{},sortOrder:3,isVisible:true}];
 const before=structuredClone(source);
 for(const locale of ['en','tr','ar']){
  const result=sharedPageHeaderBlocks(source,'Programs',locale,'programs');assert.deepEqual(result.map(b=>b.blockType),['hero','catalog_grid','progress_bars','cta_banner']);assert.deepEqual(result.map(b=>b.sortOrder),[0,1,2,3]);assert.deepEqual(sharedPageHeaderBlocks(result,'Programs',locale,'programs'),result);assert.deepEqual(result[2].content,source[1].content);
 }
 assert.deepEqual(source,before);assert.deepEqual(sharedPageHeaderBlocks(source,'Countries','en','countries').map(b=>b.blockType),source.map(b=>b.blockType));
});
