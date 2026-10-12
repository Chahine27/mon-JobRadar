/** Exemple d'offre au format de l'API France Travail v2 (données fictives), pour les tests. */
export const FT_SAMPLE_OFFER = {
  id: "199XYZT",
  intitule: "Développeur Full Stack Vue.js / Node.js (H/F)",
  description:
    "Vous rejoignez l'équipe produit. Stack : Vue 3, TypeScript, Node.js, PostgreSQL, Docker.\n" +
    "2 jours de télétravail par semaine.",
  dateCreation: "2026-09-27T09:12:44.000Z",
  dateActualisation: "2026-09-28T07:00:10.000Z",
  lieuTravail: {
    libelle: "60 - COMPIEGNE",
    latitude: 49.4179,
    longitude: 2.8261,
    codePostal: "60200",
    commune: "60159",
  },
  romeCode: "M1805",
  entreprise: { nom: "ATELIER NUMERIQUE" },
  typeContrat: "CDI",
  typeContratLibelle: "Contrat à durée indéterminée",
  natureContrat: "Contrat travail",
  experienceExige: "E",
  experienceLibelle: "2 An(s)",
  competences: [{ code: "123", libelle: "Développer une application web", exigence: "E" }],
  salaire: { libelle: "Annuel de 38000.00 Euros à 42000.00 Euros sur 12 mois" },
  alternance: false,
  origineOffre: {
    origine: "1",
    urlOrigine: "https://candidat.francetravail.fr/offres/recherche/detail/199XYZT",
  },
};
