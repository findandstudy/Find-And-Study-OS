import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { I18nContext } from '../src/lib/i18n/use-i18n-context';
import { getTranslation, installPartialTranslations, loadLanguage, SUPPORTED_LANGUAGES } from '../src/lib/i18n/index';
import { UiText, translateUi, uiTextKey } from '../src/lib/ui-localization';

test('migrated UI text follows the selected dictionary in every locale', async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(await loadLanguage(lang), true);
    const dictionary=JSON.parse(readFileSync(new URL(`../src/lib/i18n/translations/${lang}.json`, import.meta.url),'utf8'));
    for (const source of ['Required', 'Team Designer — Preview', 'Save Changes']) {
      const key=uiTextKey(source),expected=key.split('.').reduce((v,k)=>v?.[k],dictionary);
      if(expected!==undefined)assert.equal(translateUi(lang,source),expected,`${lang}:${source}`);
    }
    const context={lang,t:(key:string)=>getTranslation(lang,key),dir: 'ltr' as const,isRTL:false,localePath:(p:string)=>p,setLang:async()=>true};
    const html=renderToStaticMarkup(<I18nContext.Provider value={context}><UiText text="Required" /></I18nContext.Provider>);
    assert.ok(html.length>0);
    assert.ok(!html.includes('uiText.'));
    assert.equal(translateUi(lang, 'An unregistered synthetic UI string', 'Sentetik metin'), lang==='tr'?'Sentetik metin':'An unregistered synthetic UI string');
    assert.equal(translateUi(lang, ''), '');
  }
});

test('all occurrences of a translation variable are replaced', () => {
  installPartialTranslations('en',{uiLocalizationTest:{repeated:'{count} + {count}'}});
  assert.equal(getTranslation('en','uiLocalizationTest.repeated',{count:3}),'3 + 3');
});

test('sidebar titles use common i18n and the workspace title has every locale', () => {
  const source=readFileSync(new URL('../src/components/layout/DashboardLayout.tsx', import.meta.url),'utf8');
  assert.doesNotMatch(source,/title:\s*['"][^'"]*\p{L}[^'"]*['"]/u);
  for(const lang of SUPPORTED_LANGUAGES){const d=JSON.parse(readFileSync(new URL(`../src/lib/i18n/translations/${lang}.json`,import.meta.url),'utf8'));assert.ok(d.dashboard.teamWorkspace);if(lang==='en')assert.equal(d.dashboard.teamWorkspace,'Team workspace');}
});
