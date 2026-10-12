-- Sources JobScraper désactivées par défaut ; une fréquence quotidienne évite toute collecte agressive.
INSERT INTO "SourceState" ("source", "enabled", "intervalMinutes", "failures", "nextRunAt")
VALUES
  ('jobscraper:linkedin', false, 1440, 0, CURRENT_TIMESTAMP),
  ('jobscraper:hellowork', false, 1440, 0, CURRENT_TIMESTAMP),
  ('jobscraper:francetravail', false, 1440, 0, CURRENT_TIMESTAMP),
  ('jobscraper:wttj', false, 1440, 0, CURRENT_TIMESTAMP),
  ('jobscraper:adzuna', false, 1440, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("source") DO NOTHING;
