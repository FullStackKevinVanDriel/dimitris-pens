-- Up Migration
-- Starter catalog. Only inserts into an empty shop (no categories yet),
-- so it never touches a live catalog.
INSERT INTO categories (id, name, sort_order)
SELECT * FROM (VALUES
  ('c1', 'Fountain Pens', 0),
  ('c2', 'Rollerballs', 1),
  ('c3', 'Pencils', 2)
) AS v(id, name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM categories);

INSERT INTO products (id, name, description, price_cents, category_id, image_key, inventory, sort_order)
SELECT * FROM (VALUES
  ('p1', 'The Meridian', 'Ebonite fountain pen with a tuned steel nib. Writes wet and smooth.', 18500, 'c1', 'classic', 4, 0),
  ('p2', 'Harbor & Pine', 'Forest-green ebonite, brass trim, medium nib ground in-house.', 24000, 'c1', 'forest', 2, 1),
  ('p3', 'The Night Desk', 'Midnight-blue lacquer over brass. Our finest nib, broad italic.', 32000, 'c1', 'midnight', 1, 2),
  ('p4', 'Commuter Roller', 'Black anodized aluminum rollerball. Takes standard refills.', 8500, 'c2', 'roller', 9, 3),
  ('p5', 'Brass Daily', 'Solid brass body that picks up a patina. Weighted for long notes.', 12000, 'c2', 'brassrb', 6, 4),
  ('p6', 'Cedar No. 2', 'Hand-turned cedar mechanical pencil, 0.7mm, brass clutch.', 4500, 'c3', 'pencil', 12, 5),
  ('p7', 'The Draftsman', 'Knurled grip drafting pencil, 0.5mm. A shop favorite — back soon.', 6800, 'c3', 'pencil', 0, 6)
) AS v(id, name, description, price_cents, category_id, image_key, inventory, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM products)
  AND EXISTS (SELECT 1 FROM categories WHERE id = 'c1');

-- Down Migration
-- Intentionally empty: never delete catalog data on rollback.
