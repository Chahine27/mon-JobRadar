-- CV PDF envoyé depuis le navigateur et gardé en base (le serveur n'a pas accès aux fichiers du PC).
ALTER TABLE "LetterKit" ADD COLUMN "cvPdf" BYTEA, ADD COLUMN "cvPdfName" TEXT;
