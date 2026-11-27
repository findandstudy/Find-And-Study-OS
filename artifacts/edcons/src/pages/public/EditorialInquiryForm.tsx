import { EmbeddedLeadForm } from './EmbeddedLeadForm';
import { useI18n } from '@/hooks/use-i18n';
export function EditorialInquiryForm({content={},preview=false}:{content?:Record<string,unknown>;preview?:boolean}){
 const {t}=useI18n();return <div className="ar-form"><h3>{typeof content.formTitle==='string'?content.formTitle:t('contact.formTitle')}</h3><EmbeddedLeadForm slug={content.embedWidgetSlug} preview={preview}/></div>;
}
