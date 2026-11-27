export type PublicCountryItem={id:number|null;catalogCountryId?:number;name:string;country:string;countryCode?:string;flagEmoji?:string|null;canonicalPath:string;cardHeroImageUrl?:string|null;thumbnailUrl?:string|null;shortDescription?:string|null;universityCount:number;programCount:number;isFeatured:boolean};
export type CountryDirectoryFilter={search:string;availability:string;sort:string};
const searchable=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ı/g,'i');
export function filterCountryDirectory(items:PublicCountryItem[],filter:CountryDirectoryFilter,locale='en'){
 const query=searchable(filter.search.trim());
 return items.filter(item=>(!query||searchable(`${item.name} ${item.country} ${item.countryCode||''}`).includes(query))&&(filter.availability!=='universities'||item.universityCount>0)&&(filter.availability!=='programs'||item.programCount>0)).sort((a,b)=>filter.sort==='universities'?b.universityCount-a.universityCount||a.name.localeCompare(b.name,locale):filter.sort==='programs'?b.programCount-a.programCount||a.name.localeCompare(b.name,locale):a.name.localeCompare(b.name,locale)*(filter.sort==='za'?-1:1));
}
