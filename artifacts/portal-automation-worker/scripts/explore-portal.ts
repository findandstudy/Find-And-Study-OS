import { launchPortal } from "@workspace/portal-adapters";
import { resolvePortalCreds } from "../src/credResolver.js";

const key = process.argv[2];
const loginUrl = process.argv[3];
const formPath = process.argv[4] || "application-form";
const MAXSTEPS = 13;

const DUMP = "(() => { var acc=[]; var seen=new Set();" +
  "function lab(el){ try{ if(el.labels&&el.labels[0]) return (el.labels[0].innerText||'').trim().slice(0,60); if(el.id){var l=document.querySelector('label[for=\"'+el.id+'\"]'); if(l) return (l.innerText||'').trim().slice(0,60);} }catch(e){} return ''; }" +
  "function walk(root){ var els=[]; try{ els=Array.prototype.slice.call(root.querySelectorAll('input,select,textarea,button,[role=combobox],lightning-input,lightning-combobox,lightning-radio-group,c-eduhub-file-upload')); }catch(e){}" +
  "for(var i=0;i<els.length;i++){ var el=els[i]; if(seen.has(el))continue; seen.add(el); var g=function(a){return el.getAttribute?(el.getAttribute(a)||''):'';}; var vis=true; try{vis=el.offsetParent!==null||el.getClientRects().length>0;}catch(e){} if(!vis)continue; acc.push({tag:el.tagName.toLowerCase(),type:g('type'),name:g('name'),id:el.id||'',ph:g('placeholder'),aria:g('aria-label'),fld:g('data-field')||g('field-name'),label:lab(el),txt:(el.innerText||'').trim().slice(0,40)}); }" +
  "var all=[]; try{ all=Array.prototype.slice.call(root.querySelectorAll('*')); }catch(e){} for(var j=0;j<all.length;j++){ if(all[j].shadowRoot) walk(all[j].shadowRoot); } }" +
  "walk(document); return acc; })()";

const HEADING = "(() => { var h=document.querySelector('h1,h2,.slds-text-heading_medium,.slds-text-heading_large'); return (h&&h.innerText||document.title||'').trim().slice(0,80); })()";

(async () => {
  if (!key || !loginUrl) { console.log("usage: <key> <loginUrl> [formPath]"); process.exit(1); }
  let creds: any;
  try { creds = await resolvePortalCreds(key, key); } catch (e: any) { console.log("CREDS_ERR " + e.message); process.exit(2); }
  console.log("CREDS_OK user=" + creds.user);
  const session = await launchPortal();
  const page: any = session.page;
  const out: any = { key, steps: [] };
  const fillStep = async () => {
    try { const sa = page.getByRole("button", { name: /show all/i }).first(); if (await sa.count()) { await sa.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); } } catch (e) {}
    try { const sp = page.getByRole("button", { name: /select_program|select program|^\s*select\s*$|^\s*sec\s*$|seç/i }).first(); if (await sp.count()) { await sp.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); } } catch (e) {}
    try { const em = page.getByLabel(/e-?mail|e-?posta|mail/i).first(); if ((await em.count()) && (await em.isVisible().catch(() => false))) await em.fill("fas.test." + Date.now() + "@example.com").catch(() => {}); } catch (e) {}
    try { const pp = page.getByLabel(/passport|pasaport/i).first(); if ((await pp.count()) && (await pp.isVisible().catch(() => false))) await pp.fill("U1234567").catch(() => {}); } catch (e) {}
    try { const r = page.locator("input[type=radio]"); const rc0 = await r.count(); if (rc0) { const el = r.first(); const id = await el.getAttribute("id").catch(() => null); let ok = false; if (id) { const lb = page.locator("label[for=\"" + id + "\"]").first(); if (await lb.count()) { await lb.click({ timeout: 3000 }).catch(() => {}); ok = await el.isChecked().catch(() => false); } } if (!ok) await el.check({ force: true, timeout: 3000 }).catch(() => {}); } } catch (e) {}
    try { const s = page.locator("select"); const n = await s.count(); for (let i = 0; i < n; i++) await s.nth(i).selectOption({ index: 1 }).catch(() => {}); } catch (e) {}
    try { const t = page.locator("input[type=text],input[type=email],input[type=tel],input[type=number],input:not([type]),textarea"); const n = await t.count(); for (let i = 0; i < Math.min(n, 25); i++) { const el = t.nth(i); if (!(await el.isVisible().catch(() => false))) continue; if (await el.inputValue().catch(() => "x")) continue; const ty = (await el.getAttribute("type").catch(() => "")) || ""; let v = "Test"; if (ty === "email") v = "fas.test." + Date.now() + "@example.com"; else if (ty === "number") v = "2020"; else if (ty === "tel") v = "5551112233"; await el.fill(v).catch(() => {}); } } catch (e) {}
  };
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    for (const s of ["input[type=email]", "input[name*=email i]", "input[id*=email i]"]) { const l = page.locator(s).first(); if ((await l.count()) && (await l.isVisible().catch(() => false))) { await l.fill(creds.user); break; } }
    for (const s of ["input[type=password]", "input[name*=pass i]"]) { const l = page.locator(s).first(); if ((await l.count()) && (await l.isVisible().catch(() => false))) { await l.fill(creds.password); break; } }
    const b1 = page.getByRole("button", { name: /login|giris|sign in/i }).first();
    if (await b1.count()) await b1.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(8000);
    out.loggedIn = await page.evaluate("(() => { var p=document.querySelector('input[type=password]'); return !(p&&p.offsetParent); })()").catch(() => null);
    await page.goto(loginUrl.replace(/\/$/, "") + "/" + formPath, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(6000);
    for (let step = 1; step <= MAXSTEPS; step++) {
      const heading = await page.evaluate(HEADING).catch(() => "");
      const fields = await page.evaluate(DUMP).catch((e: any) => [{ evalErr: e.message }]);
      const hasNext = await page.getByRole("button", { name: /^\s*(next|ileri|sonraki|devam)\s*$/i }).count();
      const hasSubmit = await page.getByRole("button", { name: /submit|complete|tamamla|gönder|finish|onayla/i }).count();
      out.steps.push({ step, heading, url: page.url(), fieldCount: Array.isArray(fields) ? fields.length : -1, fields, hasNext: !!hasNext, hasSubmit: !!hasSubmit });
      await page.screenshot({ path: "/tmp/" + key + "-step" + step + ".png", fullPage: true }).catch(() => {});
      if (hasSubmit && !hasNext) { out.reachedFinal = true; break; }
      if (!hasNext) { out.stoppedNoNext = true; break; }
      await fillStep();
      await page.getByRole("button", { name: /^\s*(next|ileri|sonraki|devam)\s*$/i }).first().click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(4500);
    }
  } catch (e: any) { out.error = e.message; }
  finally { await session.close(); }
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
})();
