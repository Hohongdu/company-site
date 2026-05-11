-- Seed default product categories
-- Safe to re-run: only inserts if slug does not already exist

INSERT INTO categories (name, slug)
SELECT '진공 브레이징', 'vacuum-brazing' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'vacuum-brazing');

INSERT INTO categories (name, slug)
SELECT '특수 소재', 'special-materials' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'special-materials');

INSERT INTO categories (name, slug)
SELECT '세라믹', 'ceramics' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'ceramics');

INSERT INTO categories (name, slug)
SELECT '가공', 'machining' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'machining');

INSERT INTO categories (name, slug)
SELECT '자외선 램프', 'uv-lamps' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'uv-lamps');
