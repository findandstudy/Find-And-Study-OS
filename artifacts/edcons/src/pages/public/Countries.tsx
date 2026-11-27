import { useI18n } from '@/hooks/use-i18n';
import { SITE_NAME, SITE_URL, useJsonLd } from '@/hooks/use-json-ld';
import { useSeo } from '@/hooks/use-seo';
import { ManagedPublicPage } from './ManagedPublicPage';
import { CountryDirectory } from './CountryDirectory';
import { useTemplatePage,useTemplatePageSeo } from './useTemplatePage';
export default function Countries(){
 const {t,lang}=useI18n(),page=useTemplatePage('countries',lang);
 useSeo({title:page?.meta.title||t('seo.countriesTitle'),description:page?.meta.description||t('seo.countriesDesc'),lang,noindex:page?!page.meta.indexable:false,alternates:page?.meta.alternatePaths});useTemplatePageSeo(page);
 useJsonLd({'@context':'https://schema.org','@type':'CollectionPage','@id':SITE_URL+'/'+lang+'/countries#webpage',name:t('nav.countries')+' | '+SITE_NAME,url:SITE_URL+'/'+lang+'/countries',inLanguage:lang});
 return <ManagedPublicPage template="countries" lang={lang} page={page} slotBlockType="catalog_grid" slotContent={<CountryDirectory/>}/>;
}
