import test from "node:test";
import assert from "node:assert/strict";
import { SECTION_PRESETS, createSectionPreset, editableHomeSections } from "../src/lib/website/sectionPresets";
import { getBlockTypeDef, type PageBlock } from "../src/lib/website/blockTypes";
import { independentAboutSections } from "../src/lib/website/independentAboutSections";
import { hydrateManagedHomeDestinations } from "../src/lib/website/homeDestinationCards";
import { safeSectionImage, safeSectionUrl } from "../src/lib/website/sectionUrls";
import { renderReusableEditorial } from "../../api-server/src/lib/reusableEditorialRender";
import { getTranslation, loadLanguage } from "../src/lib/i18n/index";

test("every Home and About design has a reusable editable preset, including empty lists", () => {
  assert.equal(SECTION_PRESETS.filter(p => p.family === "Home").length, 13);
  assert.equal(SECTION_PRESETS.filter(p => p.family === "About").length, 12);
  assert.equal(new Set(SECTION_PRESETS.map(p => p.id)).size, SECTION_PRESETS.length);
  for (const preset of SECTION_PRESETS) {
    const definition = getBlockTypeDef(preset.block.blockType, preset.block.content);
    assert.ok(definition, preset.id);
    for (const field of definition.fields) if (field.type === "items") assert.ok(field.itemFields?.length, `${preset.id}.${field.key}`);
  }
});
test("preset copies never share nested content or settings and localise only local routes", () => {
  const first=createSectionPreset("about-approach","tr"), second=createSectionPreset("about-approach","tr");
  (first.content.cards as Record<string,unknown>[])[0].title="Independent";
  first.settings.sectionPadding=1;
  assert.notDeepEqual(first,second);
  assert.notEqual((second.content.cards as Record<string,unknown>[])[0].title,"Independent");
  assert.equal(second.content.ctaUrl,"/tr/contact");
  assert.equal(createSectionPreset("about-approach").content.ctaUrl,"/en/contact");
});
test("About conversion is idempotent, preserves custom blocks and does not mutate source", () => {
  const source:PageBlock[]=[{blockType:"hero",content:{title:"Title"},settings:{},sortOrder:0,isVisible:false},{blockType:"media_text",content:{title:"Story",body:"First\n\nSecond\n\nMission\n\nVision"},settings:{},sortOrder:1,isVisible:true},{blockType:"media_text",content:{title:"Extra"},settings:{},sortOrder:2,isVisible:true}];
  const snapshot=structuredClone(source), converted=independentAboutSections(source,"en");
  assert.deepEqual(source,snapshot);
  assert.deepEqual(independentAboutSections(converted,"en"),converted);
  assert.equal(converted[0].isVisible,false);
  assert.ok(converted.some(b=>b.content.title==="Extra"));
  assert.equal(converted.find(b=>b.content.variant==="about-intro")?.content.body,"First");
  const approach=converted.find(b=>b.content.variant==="about-approach")!;
  (approach.content.cards as Record<string,unknown>[])[0].description="Different";
  assert.equal(converted.find(b=>b.content.variant==="about-intro")?.content.body,"First");
});
test("manual Home media survives hydration while live copies follow catalogue", () => {
  const manual=createSectionPreset("home-0"), live={...structuredClone(manual),content:{...manual.content,dataMode:"live"}};
  const hydrated=hydrateManagedHomeDestinations([manual,live],[{name:"Turkey",canonicalPath:"/en/countries/turkey",cardHeroImageUrl:"/turkey.png"}]);
  assert.deepEqual(hydrated[0],manual);
  assert.notDeepEqual(hydrated[1],live);
  assert.equal(editableHomeSections([live])[0].content.sectionPreset,"home-0");
});
test("media and links reject executable or ambiguous URLs", () => {
  for(const url of ["javascript:alert(1)","//evil.test/x","/../secret","/a\\x","data:text/html,abc"]) assert.equal(safeSectionUrl(url),null);
  assert.equal(safeSectionImage("mailto:test@example.test"),null);
  assert.equal(safeSectionImage("/images/hero.png"),"/images/hero.png");
});
test("generated labels use the loaded locale once and preserve later editorial choices", async () => {
  await loadLanguage("fr");
  const stale:PageBlock={blockType:"hero",content:{variant:"about-banner",title:getTranslation("en","about.badge"),breadcrumbLabel:"Custom breadcrumb"},settings:{},sortOrder:0,isVisible:true};
  const fixed=independentAboutSections([stale],"fr");
  assert.equal(fixed[0].content.title,getTranslation("fr","about.badge"));
  assert.equal(fixed[0].content.breadcrumbLabel,"Custom breadcrumb");
  fixed[0].content.title="My own title";
  assert.equal(independentAboutSections(fixed,"fr")[0].content.title,"My own title");
  assert.equal(stale.content.title,getTranslation("en","about.badge"));
});
test("editorial server rendering retains independent content and escapes author input", () => {
  const escape=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
  const result=renderReusableEditorial({variant:"about-intro",title:"<script>",body:"Own body",detailBody:"Own detail",captionBody:"Own caption",imageUrl:"javascript:alert(1)"},{escape,image:safeSectionImage,url:safeSectionUrl})!;
  for(const text of ["Own body","Own detail","Own caption","&lt;script>"]) assert.ok(result.includes(text));
  assert.ok(!result.includes("javascript:"));
  assert.equal(renderReusableEditorial({variant:"unknown"},{escape,image:safeSectionImage,url:safeSectionUrl}),null);
});
