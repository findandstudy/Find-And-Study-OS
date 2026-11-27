import { useEffect,useMemo,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { ArrowUpRight,Building2,GraduationCap,Globe2,Search } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { CountryFlag,countryCodeFromEmoji } from '@/components/CountryFlag';
import { safeSectionImage,safeSectionUrl } from '@/lib/website/sectionUrls';
import { filterCountryDirectory,type PublicCountryItem } from '@/lib/website/countryDirectory';
import './countryDirectory.css';
export function CountryDirectory({title,subtitle,eyebrow}:{title?:string;subtitle?:string;eyebrow?:string}){
 const {t,lang}=useI18n();const tr=lang==='tr';const [search,setSearch]=useState(''),[availability,setAvailability]=useState('all'),[sort,setSort]=useState('az'),[page,setPage]=useState(1);
 const query=useQuery<PublicCountryItem[]>({queryKey:['public-active-countries',lang],queryFn:()=>customFetch(`/api/public/destinations?scope=active&locale=${encodeURIComponent(lang)}`),staleTime:60000,retry:1});
 const filtered=useMemo(()=>filterCountryDirectory(query.data||[],{search,availability,sort},lang),[query.data,search,availability,sort,lang]);
 useEffect(()=>setPage(1),[search,availability,sort,lang]);const pages=Math.max(1,Math.ceil(filtered.length/12)),current=Math.min(page,pages),visible=filtered.slice((current-1)*12,current*12);
 const copy=(key:string,en:string,turkish:string)=>{const value=t(`countries.${key}`);return value===`countries.${key}`?(tr?turkish:en):value;};
 return <section className="public-country-directory" id="destination-list"><div className="country-directory-inner">
 {(title||subtitle)&&<header>{eyebrow&&<span className="home-section-kicker">{eyebrow}</span>}{title&&<h2>{title}</h2>}{subtitle&&<p>{subtitle}</p>}</header>}
 <div className="country-directory-filters" role="search" aria-label={copy('filterCountries','Filter countries','Ülkeleri filtrele')}>
 <label><span>{copy('searchCountries','Search countries','Ülke ara')}</span><div><Search aria-hidden="true"/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={copy('searchCountries','Search countries','Ülke ara')}/></div></label>
 <label><span>{copy('studyOptions','Study options','Eğitim seçenekleri')}</span><select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="all">{copy('allCountries','All active countries','Tüm aktif ülkeler')}</option><option value="universities">{copy('withUniversities','With universities','Üniversitesi bulunanlar')}</option><option value="programs">{copy('withPrograms','With programs','Programı bulunanlar')}</option></select></label>
 <label><span>{copy('sortCountries','Sort countries','Ülkeleri sırala')}</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="az">A–Z</option><option value="za">Z–A</option><option value="universities">{copy('mostUniversities','Most universities','Üniversite sayısı')}</option><option value="programs">{copy('mostPrograms','Most programs','Program sayısı')}</option></select></label>
 <button type="button" onClick={()=>{setSearch('');setAvailability('all');setSort('az');}} disabled={!search&&availability==='all'&&sort==='az'}>{copy('resetFilters','Reset filters','Filtreleri sıfırla')}</button></div>
 <p role="status" className="country-directory-count">{filtered.length} / {query.data?.length||0} {t('nav.countries')}</p>
 {query.isLoading?<div className="country-directory-grid" aria-busy="true">{Array.from({length:6},(_,i)=><div key={i} className="country-directory-skeleton"/>)}</div>:query.isError?<div role="alert">{t('common.error')} <button type="button" onClick={()=>query.refetch()}>{copy('retry','Retry','Yeniden dene')}</button></div>:visible.length===0?<p className="country-directory-empty">{t('countries.noDestinations')}</p>:<div className="country-directory-grid">{visible.map(item=>{const href=safeSectionUrl(item.canonicalPath),image=safeSectionImage(item.cardHeroImageUrl||item.thumbnailUrl);const iso=item.countryCode|| (item.country?.length===2?item.country:item.flagEmoji?countryCodeFromEmoji(item.flagEmoji):null);const body=<><div className="country-directory-image">{image?<img src={image} alt={item.name} loading="lazy"/>:iso?<CountryFlag code={iso} size="3xl" alt={item.name}/>:<Globe2 aria-hidden="true"/>}{href&&<span className="country-directory-arrow"><ArrowUpRight aria-hidden="true"/></span>}</div><div className="country-directory-copy"><h3>{item.name}</h3>{item.shortDescription&&<p>{item.shortDescription}</p>}<div><span><Building2 aria-hidden="true"/>{item.universityCount} {t('countries.universities')}</span><span><GraduationCap aria-hidden="true"/>{item.programCount} {t('countries.programs')}</span></div></div></>;
 return <article className="country-directory-card" key={item.catalogCountryId||item.id||item.name}>{href?<a href={href}>{body}</a>:body}</article>;})}</div>}
 {pages>1&&<nav className="country-directory-pagination" aria-label={copy('countryPages','Country pages','Ülke sayfaları')}><button type="button" disabled={current<=1} onClick={()=>setPage(n=>n-1)}>{t('common.previous')}</button><span>{current} / {pages}</span><button type="button" disabled={current>=pages} onClick={()=>setPage(n=>n+1)}>{t('common.next')}</button></nav>}
 </div></section>;
}
