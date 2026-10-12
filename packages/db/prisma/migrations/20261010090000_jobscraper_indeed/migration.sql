-- Indeed (via JobSpy, file JobScraper) : désactivé par défaut, une collecte par jour.
INSERT INTO "SourceState" ("source", "enabled", "intervalMinutes", "failures", "nextRunAt")
VALUES ('jobscraper:indeed', false, 1440, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("source") DO NOTHING;
