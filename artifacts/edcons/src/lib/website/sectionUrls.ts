export function safeSectionUrl(value: unknown): string | null {
 if(typeof value!=="string"||value.length>2048||/[\u0000-\u001f\u007f\\]/.test(value))return null;
 const url=value.trim();if(url.startsWith("/")&&!url.startsWith("//")&&!url.includes(".."))return url;
 if(/^#[a-zA-Z][\w-]*$/.test(url))return url;
 try{return ["https:","mailto:","tel:"].includes(new URL(url).protocol)?url:null;}catch{return null;}
}
export function safeSectionImage(value: unknown): string|null {const url=safeSectionUrl(value);return url&&(url.startsWith("/")||url.startsWith("https://"))?url:null;}
