export type ContractEmailDelivery = {state:'pending'|'sent'|'attention'|'unconfirmed';acceptedAt?:string|null};
export function ContractEmailStatus({delivery,lang}:{delivery?:ContractEmailDelivery;lang:string}) {
  const copy=lang==='tr'?{
    pending:'İmzalı PDF e-postası gönderilmeyi bekliyor.',
    sent:'İmzalı PDF e-postası posta sunucusu tarafından kabul edildi. Gelen kutunuzu ve spam klasörünüzü kontrol edin.',
    attention:'E-postanın gönderildiği doğrulanamadı. Ekibimiz kontrol etmelidir; tekrar imzalamanız gerekmez.',
    unconfirmed:'E-posta gönderimi henüz doğrulanmadı. İmzanız kayıtlıdır.',
  }:{
    pending:'Your signed PDF email is waiting to be sent.',
    sent:'Your signed PDF email was accepted by the mail server. Check your inbox and spam folder.',
    attention:'Email sending could not be confirmed. Our team needs to check it; you do not need to sign again.',
    unconfirmed:'Email sending has not been confirmed. Your signature is saved.',
  };
  return <p className='text-xs text-muted-foreground' role='status' data-testid='contract-email-status'>{copy[delivery?.state||'unconfirmed']}</p>;
}
