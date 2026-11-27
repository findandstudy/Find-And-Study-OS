import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDENT_SERVICES, canonicalServiceSlug, servicePageBlocks, contactDesignBlocks } from '@workspace/api-zod/student-services';
import { parseWebsitePageDraft } from '../src/lib/websitePageAuthoring';
import { renderServiceEditorial } from '../src/lib/serviceEditorialRender';
import { inspectWebsitePageBlockLinks, inspectWebsitePageTranslations } from '../src/lib/websitePagePublicationPreflight';

test('every service creates independent bilingual editable drafts with SEO and canonical links', () => {
  const definitions = ['services', ...STUDENT_SERVICES.map(s => canonicalServiceSlug(s.slug))];
  for (const slug of definitions) {
    const input = {title: slug, slug, locale:'en', starter:slug === 'services' ? 'student-services' : `student-service:${slug}`};
    const draft = parseWebsitePageDraft(input);
    assert.equal(draft.page.status, 'draft');
    assert.equal(draft.page.robotsIndex, false);
    assert.ok(draft.page.metaDescription);
    assert.equal(draft.blocks.length, 2);
    assert.deepEqual(inspectWebsitePageBlockLinks(draft.blocks).blockers, []);
    assert.deepEqual(inspectWebsitePageTranslations(draft.blocks, draft.page.translationsJson).blockers, []);
    assert.ok(draft.page.translationsJson?.tr.blocks.length);
    draft.blocks[1].content.title = 'Changed';
    assert.notEqual(servicePageBlocks(slug)[1].content.title, 'Changed');
    assert.throws(() => parseWebsitePageDraft({...input, status:'published'}));
    assert.throws(() => parseWebsitePageDraft({...input, locale:'unknown'}));
  }
  assert.throws(() => parseWebsitePageDraft({title:'Unknown',slug:'unknown',starter:'student-service:unknown'}));
  const menu = servicePageBlocks('airport-transfer')[1].content.menuItems as {url:string}[];
  assert.equal(menu.length, 6);
  assert.ok(menu.some(i => i.url === '/en/student-accommodation'));
  assert.ok(!menu.some(i => i.url === '/en/accommodation'));
});

test('service server render retains content, FAQ and navigation while escaping editor input', () => {
  const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const helpers={escape,image:(v:unknown)=>typeof v==='string'&&v.startsWith('/images/')?v:null,url:(v:unknown)=>typeof v==='string'&&v.startsWith('/')?v:null};
  const c=servicePageBlocks('airport-transfer')[1].content;
  const html=renderServiceEditorial({...c,title:'<script>bad</script>',contactUrl:'javascript:bad'},helpers)!;
  assert.ok(html.includes(String(c.intro)));
  assert.ok(html.includes('Frequently Asked Questions'));
  assert.ok(html.includes('/en/health-insurance'));
  assert.ok(html.includes('&lt;script>'));
  assert.ok(!html.includes('javascript:'));
  assert.equal(renderServiceEditorial({variant:'unknown'},helpers),null);
});

test('contact has an editable banner, workspace and location without invented opening hours', () => {
  for (const locale of ['en','tr']) {
    const blocks=contactDesignBlocks(locale);
    assert.deepEqual(blocks.map(b=>b.content.variant),['about-banner','contact-workspace','contact-map']);
    assert.equal(blocks[1].content.hours,'');
    assert.equal(blocks[1].content.dataMode,'live');
  }
});
