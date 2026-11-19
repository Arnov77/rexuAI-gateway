INSERT INTO "token_packages" ("slug", "name", "token_amount", "price_idr", "is_active", "sort_order")
VALUES
	('starter', 'Starter', 6500, 2000, true, 1),
	('basic', 'Basic', 16500, 5000, true, 2),
	('standard', 'Standard', 33500, 10000, true, 3),
	('plus', 'Plus', 67500, 20000, true, 4),
	('pro', 'Pro', 170000, 50000, true, 5),
	('scale', 'Scale', 350000, 100000, true, 6)
ON CONFLICT ("slug") DO NOTHING;