import assert from 'node:assert/strict';
import { test } from 'node:test';
import { academyProfileClaims } from '../src/lib/academyProfileClaims';
test('business name fallback and country are sent together', () => {
  assert.deepEqual(academyProfileClaims({companyName:null,businessName:' Test Agency ',country:' United States '}), {company:'Test Agency',country:'United States'});
});
test('canonical company wins, blank canonical falls back', () => {
  assert.equal(academyProfileClaims({companyName:'Canonical',businessName:'Other'}).company,'Canonical');
  assert.equal(academyProfileClaims({companyName:' ',businessName:'Other'}).company,'Other');
});
test('missing and malformed profiles cannot fabricate claims', () => {
  assert.deepEqual(academyProfileClaims(null),{company:null,country:null});
  assert.deepEqual(academyProfileClaims({companyName:{bad:true},businessName:'x'.repeat(181),country:'TR\nUS'}),{company:null,country:null});
});
