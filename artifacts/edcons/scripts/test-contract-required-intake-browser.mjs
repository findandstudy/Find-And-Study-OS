// Built SignFlow, synthetic replies only: no live session, signature or email.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const requireApi = createRequire(new URL('../../api-server/package.json', import.meta.url));
const { chromium } = requireApi('playwright-core');
const root = fileURLToPath(new URL('../dist/public/', import.meta.url));
const mime = { '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) throw new Error('API must be mocked');
    const target = path.resolve(root, path.extname(pathname) ? pathname.slice(1) : 'index.html');
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('invalid path');
    res.setHeader('Content-Type', mime[path.extname(target)] || 'text/html');
    res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel:'chrome' }) });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [lang,width] of [['en',1440],['tr',390],['ar',390]]) {
    const locale = JSON.parse(await readFile(new URL(`../src/lib/i18n/translations/${lang}.json`, import.meta.url), 'utf8'));
    const page = await browser.newPage({ viewport:{width,height:900} });
    page.setDefaultTimeout(10000);
    const errors = [], dialogs = [], requests = [];
    let reads = 0, stale = false, signed = false, rejectSave = false;
    let saved = { fullName:'TEST ONLY Person', email:'test@example.invalid', phone:'+12025550123', agencyPhone:'+12025550123', agentApplicationContractHash:'test-server-owned-hash' };
    const schema = () => [
      {key:'fullName',label:'TEST full name',type:'text',required:true},
      {key:'email',label:'TEST email',type:'email',required:true},
      {key:'whatsapp_phone',label:'TEST WhatsApp',type:'tel',required:true},
      {key:'taxNumber',label:'TEST tax number',type:'text',required:true},
      ...(stale ? [{key:'address',label:'TEST address',type:'text',required:true}] : []),
    ];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.addInitScript(value => { if (window === window.top) localStorage.setItem('edcons_lang',value); },lang);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const method = route.request().method();
      const answer = (status,body) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if (url.pathname === '/api/public/sign/SYNTHETIC-INTAKE-ONLY') {
        reads++;
        return answer(200,{data:{sessionId:123,mode:'self_fill',status:signed?'signed':'review_pending',expired:false,
          signerName:'TEST ONLY Person',signerEmail:'test@example.invalid',verifiedEmail:'test@example.invalid',emailVerificationRequired:true,
          intakeData:saved,missingIntakeFields:signed?['whatsapp_phone']:schema().filter(f=>!saved[f.key]).map(f=>f.key),
          template:{name:'TEST ONLY Agreement',language:lang,intakeSchema:schema(),signingPageConfig:{}}}});
      }
      if (url.pathname.endsWith('/preview.html')) return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><h1>TEST ONLY contract preview</h1>'});
      if (method === 'POST') requests.push({path:url.pathname,body:route.request().postDataJSON()});
      if (url.pathname.endsWith('/intake')) {
        if (rejectSave) return answer(400,{code:'CONTRACT_INTAKE_REQUIRED',missingFields:['taxNumber'],error:'TEST server rejected required value'});
        saved = {...requests.at(-1).body.intake,agentApplicationContractHash:'test-server-preserved-hash'};
        return answer(200,{success:true,intakeData:saved});
      }
      if (url.pathname.endsWith('/sign')) {
        stale = true;
        return answer(409,{code:'CONTRACT_INTAKE_REQUIRED',missingFields:['address'],error:'TEST new required field'});
      }
      if (url.pathname === '/api/public/countries') return answer(200,{data:[{id:1,name:'Turkey',code:'TR',dialCode:'+90'}]});
      if (url.pathname === '/api/settings/branding') return answer(200,{companyName:'TEST ONLY',hasLogo:false});
      if (url.pathname === '/api/auth/me') return answer(401,{error:'No synthetic signed-in account'});
      return answer(200,{data:[]});
    });
    await page.goto(`${base}/sign/SYNTHETIC-INTAKE-ONLY`);
    const next = page.getByRole('button',{name:locale.sign.continue,exact:true});
    const whatsapp = page.locator('[data-intake-field="whatsapp_phone"] input[type="tel"]');
    await whatsapp.waitFor();
    assert.equal(await whatsapp.inputValue(),'','WhatsApp is not inferred from generic phone');
    assert.equal(await next.isDisabled(),true,'review_pending cannot bypass missing intake');
    await page.getByRole('alert').filter({hasText:'TEST WhatsApp'}).waitFor();
    await whatsapp.fill('5550000011');
    assert.equal(await next.isDisabled(),true,'every required field, not only WhatsApp, is required');
    await page.locator('[data-intake-field="taxNumber"] input').fill('TEST-TAX-ONLY');
    assert.equal(await next.isEnabled(),true);
    rejectSave = true;
    await next.click();
    await page.getByRole('alert').filter({hasText:'TEST server rejected required value'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:locale.sign.titleReview,exact:true}).count(),0,'failed save stays in intake');
    rejectSave = false;
    await next.click();
    await page.getByRole('heading',{name:locale.sign.titleReview,exact:true}).waitFor();
    assert.equal(saved.whatsapp_phone,'+905550000011','only explicitly entered number is submitted');
    assert.equal(saved.phone,'+12025550123');
    // Back to the actual form proves it adopted the server's saved projection.
    await page.getByRole('button',{name:locale.sign.back,exact:true}).click();
    await next.click();
    assert.equal(requests.at(-1).body.intake.agentApplicationContractHash,'test-server-preserved-hash');
    await page.getByRole('button',{name:locale.sign.sign,exact:true}).click();
    const canvas = page.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x+30,box.y+30); await page.mouse.down();
    await page.mouse.move(box.x+90,box.y+60,{steps:5}); await page.mouse.up();
    await page.getByRole('checkbox').check();
    const before = reads;
    await page.getByRole('button',{name:locale.sign.signAndSend,exact:true}).click();
    await page.locator('[data-intake-field="address"] input').waitFor();
    assert.ok(reads>before,'stale finalization reloads the server schema');
    assert.equal(await next.isDisabled(),true);
    assert.equal(await whatsapp.inputValue(),'5550000011','saved user WhatsApp survives schema refresh');
    assert.deepEqual(dialogs,[],'required intake failures are recoverable inline');
    assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),`${lang}: mobile form does not overflow`);
    // A previously signed session must never be reopened for newly required fields.
    signed = true;
    await page.reload();
    await page.getByRole('heading',{name:locale.sign.signed,exact:true}).waitFor();
    assert.equal(await page.locator('[data-intake-field="whatsapp_phone"]').count(),0);
    assert.equal(requests.filter(r=>r.path.endsWith('/sign')).length,1,'only mocked signing attempt');
    assert.equal(requests.filter(r=>!r.path.endsWith('/sign')&&!r.path.endsWith('/intake')).length,0,'no other mutations');
    assert.deepEqual(errors,[]);
    console.log(`PASS ${lang}/${width}: explicit WhatsApp, required fields, failed save, server projection, stale signing recovery, signed immutability`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
