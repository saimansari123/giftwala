-- Repair the known source-data mismatch for GW-FW-001.
-- Values are copied from server/sheet-products.json; no business values are inferred.
UPDATE products
SET name = 'Customized 2 in 1 3D Magic Mirror Frame',
    category = 'Frames & Wall Art',
    price = 699,
    sale_price = NULL,
    stock = 20,
    description = 'Turn a favourite photo, name or milestone into a display piece with Customized 2 in 1 3D Magic Mirror Frame.',
    image_url = 'https://drive.google.com/file/d/1EqJW1CsVl_-XpXWYDtyQxaRYM3CAQpVR/view'
WHERE sku = 'GW-FW-001';
