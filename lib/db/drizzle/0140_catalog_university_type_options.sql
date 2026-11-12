INSERT INTO catalog_options (category, value, sort_order, is_active, metadata)
SELECT seed.category, seed.value, seed.sort_order, TRUE, seed.metadata::jsonb
FROM (VALUES
  ('university_type', 'Public', 10, '{"label":"Public University","aliases":["Public University","State","State University","Devlet","Devlet Üniversitesi"]}'),
  ('university_type', 'Private', 20, '{"label":"Private University","aliases":["Private University","Özel","Ozel","Özel Üniversite","Foundation","Foundation University","Vakıf","Vakıf Üniversitesi"]}'),
  ('university_type', 'Foundation University', 30, '{"label":"Foundation University","aliases":["Foundation","Vakıf","Vakıf Üniversitesi"]}'),
  ('university_type', 'College', 40, '{"label":"College","aliases":[]}'),
  ('university_type', 'Community College', 50, '{"label":"Community College","aliases":[]}'),
  ('university_type', 'Language School', 60, '{"label":"Language School","aliases":["Language Centre","Language Center"]}'),
  ('university_type', 'Vocational School', 70, '{"label":"Vocational School","aliases":["Vocational College"]}'),
  ('university_type', 'Institute / Academy', 80, '{"label":"Institute / Academy","aliases":["Institute","Academy"]}'),
  ('university_type', 'Pathway Provider', 90, '{"label":"Pathway Provider","aliases":["Pathway College","Pathway Centre","Pathway Center"]}'),
  ('university_type', 'High School', 100, '{"label":"High School","aliases":["Secondary School"]}')
) AS seed(category, value, sort_order, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM catalog_options existing
  WHERE existing.category = seed.category
    AND lower(trim(existing.value)) = lower(trim(seed.value))
);

UPDATE catalog_options existing
SET metadata = seed.metadata::jsonb,
    sort_order = seed.sort_order,
    updated_at = now()
FROM (VALUES
  ('Public', 10, '{"label":"Public University","aliases":["Public University","State","State University","Devlet","Devlet Üniversitesi"]}'),
  ('Private', 20, '{"label":"Private University","aliases":["Private University","Özel","Ozel","Özel Üniversite","Foundation","Foundation University","Vakıf","Vakıf Üniversitesi"]}')
) AS seed(value, sort_order, metadata)
WHERE existing.category = 'university_type'
  AND lower(trim(existing.value)) = lower(trim(seed.value));
