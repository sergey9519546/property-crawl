INSERT INTO sources (key, label, tier, color, note, website_url) VALUES
  ('servicelink', 'Public Auction Network', 'B', '#0369a1', 'Public auction listings; sale status and terms require confirmation', 'https://www.servicelinkauction.com')
ON CONFLICT (key) DO NOTHING;
