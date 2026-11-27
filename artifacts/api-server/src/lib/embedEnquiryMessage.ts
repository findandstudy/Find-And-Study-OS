/** Plain text only; preserve paragraphs and never turn a blank enquiry into a zero. */
export function normalizeEmbedEnquiryMessage(value:unknown):string|null{
 if(typeof value!=='string')return null;
 return value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,5000)||null;
}
