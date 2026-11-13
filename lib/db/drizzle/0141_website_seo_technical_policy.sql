ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "seo_technical_policy" jsonb NOT NULL DEFAULT '{"version":1,"allowOaiSearchBot":true,"allowGptBot":false,"allowGoogleExtended":false,"maxSnippet":-1,"maxImagePreview":"large","maxVideoPreview":-1,"xDefaultLocale":"en","indexNowEnabled":false}'::jsonb;

ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_seo_technical_policy_chk";
ALTER TABLE "settings" ADD CONSTRAINT "settings_seo_technical_policy_chk" CHECK (
  jsonb_typeof("seo_technical_policy") = 'object'
  AND ("seo_technical_policy"->>'version')::integer = 1
  AND jsonb_typeof("seo_technical_policy"->'allowOaiSearchBot') = 'boolean'
  AND jsonb_typeof("seo_technical_policy"->'allowGptBot') = 'boolean'
  AND jsonb_typeof("seo_technical_policy"->'allowGoogleExtended') = 'boolean'
  AND ("seo_technical_policy"->>'maxSnippet')::integer BETWEEN -1 AND 10000
  AND "seo_technical_policy"->>'maxImagePreview' IN ('none', 'standard', 'large')
  AND ("seo_technical_policy"->>'maxVideoPreview')::integer BETWEEN -1 AND 10000
  AND "seo_technical_policy"->>'xDefaultLocale' IN ('en','tr','ar','fr','ru','fa','zh','hi','es','id','ur','tk','ky','kk','uz','tg','bn','pt','ne','vi','ko','uk','it')
  AND jsonb_typeof("seo_technical_policy"->'indexNowEnabled') = 'boolean'
);
