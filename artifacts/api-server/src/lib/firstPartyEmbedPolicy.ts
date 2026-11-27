export function canIssueFirstPartyEmbedToken(input:{origin:string;referer?:string;fetchSite?:string;mode:string;agentId:number|null;domains:unknown}):boolean{
 if(input.mode!=='lead_form'||input.agentId!==null||input.fetchSite!=='same-origin')return false;
 try{
  const origin=new URL(input.origin),referer=new URL(input.referer||'');
  if(!['https:','http:'].includes(origin.protocol)||origin.origin!==referer.origin)return false;
  return Array.isArray(input.domains)&&input.domains.some(domain=>typeof domain==='string'&&domain.trim().toLowerCase()===origin.hostname.toLowerCase());
 }catch{return false;}
}
