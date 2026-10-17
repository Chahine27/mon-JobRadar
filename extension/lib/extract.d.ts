// Types pour l'API (apps/api/src/job-from-url.ts), qui réutilise la lecture de page de l'extension.
export interface PageHints {
  title: string | null;
  company: string | null;
  location: string | null;
  contractType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
}
export interface PagePayload {
  url: string;
  source: string | null;
  text: string;
  hints: PageHints;
}
export function htmlToText(html: string | null | undefined): string;
export function linkedinJobUrl(url: string): string;
export function indeedJobUrl(url: string): string;
export function buildPayload(raw: Record<string, unknown>): PagePayload;
