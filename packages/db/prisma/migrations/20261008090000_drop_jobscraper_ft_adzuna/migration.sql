-- JobScraper France Travail et Adzuna retirés : ces sites sont déjà collectés par leurs API.
-- Les offres déjà importées et leurs liens restent ; seuls les réglages de collecte disparaissent.
DELETE FROM "SourceState" WHERE "source" IN ('jobscraper:francetravail', 'jobscraper:adzuna');
