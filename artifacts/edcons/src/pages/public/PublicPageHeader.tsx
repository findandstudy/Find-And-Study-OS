import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { safeSectionImage, safeSectionUrl } from '@/lib/website/sectionUrls';
import { capitalizePageLabel } from '@/lib/website/pageHeader';
import './publicPageHeader.css';
export function PublicPageHeader({title,backgroundImage='/images/about-reference/page-banner.png',homeLabel,homeUrl,parents=[]}:{title:string;backgroundImage?:unknown;homeLabel?:string;homeUrl?:string;parents?:{title:string;url:string}[]}){
  const { lang: uiLanguage } = useUiLanguage();
 const {lang,t}=useI18n();const image=safeSectionImage(backgroundImage);
 const crumbs=[{title:homeLabel||t('nav.home'),url:homeUrl||`/${lang}`},...parents];
 return <section className="public-page-header" style={image?{backgroundImage:`linear-gradient(#101828a6,#101828a6),url(${JSON.stringify(image)})`}:undefined}>
  <nav aria-label={translateUi(uiLanguage, "Breadcrumb")}>{crumbs.map((crumb,i)=><span key={i}>{safeSectionUrl(crumb.url)&&<a href={safeSectionUrl(crumb.url)!}>{capitalizePageLabel(crumb.title,lang)}</a>}<ChevronRight size={17} aria-hidden="true"/></span>)}<span aria-current="page">{capitalizePageLabel(title,lang)}</span></nav>
  <h1>{capitalizePageLabel(title,lang)}</h1>
 </section>;
}
