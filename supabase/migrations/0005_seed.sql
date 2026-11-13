-- =============================================================================
-- AKANA MISSION CONTROL — 0005: Başlangıç verisi
-- =============================================================================

insert into public.departments (name, code, description) values
  ('Mekanik',       'MEK', 'Gövde, yapısal tasarım, üretim ve entegrasyon'),
  ('Aviyonik',      'AVY', 'Uçuş bilgisayarı, sensörler, gömülü yazılım ve haberleşme'),
  ('Aerodinamik',   'AER', 'Akış analizi, stabilite ve uçuş benzetimleri'),
  ('Kurtarma',      'KUR', 'Paraşüt, ayrılma mekanizmaları ve kurtarma sistemi'),
  ('Yer İstasyonu', 'YER', 'Telemetri, arayüz ve yer destek ekipmanları'),
  ('Sponsorluk',    'SPN', 'Sponsorluk, bütçe ve kurumsal iletişim')
on conflict do nothing;

insert into public.app_settings (key, value) values ('max_file_size_mb', '25'::jsonb)
on conflict (key) do nothing;
