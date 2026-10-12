export type Point = { lat: number; lng: number };

export type TravelEstimate = {
  /** Durée porte-à-porte estimée en transports en commun. null = non calculable (jamais inventée). */
  minutes: number | null;
  provider: string;
  /** Pourquoi il n'y a pas de durée (ex. « no_origin » : départ hors de la zone couverte). */
  reason?: string;
};

/** Abstraction du calcul d'itinéraire (README §22) : on peut changer de fournisseur sans toucher au reste. */
export interface RoutingService {
  readonly name: string;
  isConfigured(): boolean;
  estimateTravelTime(origin: Point, destination: Point): Promise<TravelEstimate>;
}

export type GeocodeResult = Point & { label: string; precision: "address" | "city_centroid" };
