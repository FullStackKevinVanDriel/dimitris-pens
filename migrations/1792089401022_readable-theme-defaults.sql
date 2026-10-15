-- Up Migration
-- #33: brass and sold-out text defaults were darkened to meet WCAG AA
-- contrast. Saving "Text & look" used to store every field, which would pin
-- the old low-contrast defaults; drop exactly those stored values so the new
-- defaults apply. Any other (deliberately chosen) color is left alone.
DELETE FROM site_settings
WHERE (key = 'color_brass' AND value = '"#a67c3d"'::jsonb)
   OR (key = 'color_sold'  AND value = '"#8a8474"'::jsonb);

-- Down Migration
-- Nothing to restore: the removed rows equalled the old defaults.
