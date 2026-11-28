const fs=require('node:fs'),path=require('node:path');const file=path.resolve(__dirname,'../artifacts/edcons/src/pages/staff/Settings.tsx');let source=fs.readFileSync(file,'utf8');
for(const name of ['ProfileTab','SecurityTab','BrandingTab','CompanyTab','SeoTab','EmailBrandingTab','DocumentsTab','AdvancedTab'])source=source.replace(`function ${name}() {\n  const { lang: uiLanguage } = useUiLanguage();`,`function ${name}() {`);
// These legacy render helpers are called as functions. They inherit the page's
// unconditional locale hook instead of adding conditional hook invocations.
fs.writeFileSync(file,source);
