CREATE TABLE IF NOT EXISTS builder_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO builder_settings (key,value) VALUES
 ('eyebrow','MAKE IT UNIQUELY THEIRS'),
 ('title','Build your perfect box.'),
 ('description','Pick a box, add their favourite things and finish it with a personal note. We''ll wrap it beautifully and send it straight to them.'),
 ('buttonText','Start customising ->'),
 ('smallName','Small box'),('smallLimit','Up to 3 items'),('smallPrice','499'),
 ('classicName','Classic box'),('classicLimit','Up to 5 items'),('classicPrice','799'),
 ('premiumName','Premium box'),('premiumLimit','Up to 8 items'),('premiumPrice','1199');
