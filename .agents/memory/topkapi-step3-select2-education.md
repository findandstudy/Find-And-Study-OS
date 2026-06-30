---
name: Topkapı Step 3 education-level select2 + prior-education
description: Why Step 3 dependent fields never render, and the prior-education + placeholder-guard rules for the education-level dropdown
---

Step 3 (education background) on the Topkapı portal AJAX-renders its dependent
row fields (schoolName / gpa / graduationDate / country) ONLY after the
education-level dropdown receives a real selection. Two traps:

1. **Never accept the placeholder as a real selection.** The level dropdown is a
   select2 whose placeholder ("Seçim Yapın") carries a non-empty value, so a
   guard of `value && value !== "0"` false-positives → the change handler never
   fires → dependent fields never render → downstream fills hit "no element
   found" / "empty after retry". Verify the read-back with a placeholder check on
   BOTH value and (folded) text, not just value.

2. **Step 3 wants the applicant's PRIOR completed education, not the applied
   program level.** A Bachelor applicant's prior level is "Lise"/"High School";
   a Master's applicant's is "Lisans"/"Bachelor"; a Doctorate applicant's is
   "Yüksek Lisans"/"Master". Selecting the applied level (mapEduLevel output) is
   wrong here — that mapping is only for Step 4's program-level radio.

**Why:** select2 keeps a hidden native `<select>` in sync, but `page.selectOption`
can't click a display:none select2. Set the value in-page and fire BOTH native
change and `jQuery(el).val(v).trigger("change")` so the widget's AJAX handler
runs; then `waitForSelector` the first dependent field before filling.

**How to apply:** for select2/<select> dropdowns whose dependents load via AJAX,
match candidate labels against the REAL option texts (fold() exact then
substring, skip index 0), set by option value in-page, verify read-back is not a
placeholder, retry once, then await the dependent field. Keep the fail-visible
gate (throw if level/school/gpa/grad stay empty). Diagnose the widget FIRST
(select2 detection + options + outerHTML) — failures are widget-specific.
