import type { FetchLike } from "../types";
import { SourceHttpError } from "../types";

/** Outils de recrutement dont la page carrières publique a une adresse de données documentée. */
export const ATS_KINDS = ["greenhouse", "lever", "ashby", "recruitee"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

export type CompanyTarget = { id: string; name: string; ats: AtsKind; boardKey: string; enabled: boolean };

/** Offre d'un site carrières, prête pour la normalisation. */
export type AtsPosting = {
  ats: AtsKind;
  boardKey: string;
  companyName: string;
  id: string;
  title: string;
  /** HTML ou texte brut selon l'outil (voir `descriptionIsHtml`). */
  description: string;
  descriptionIsHtml: boolean;
  location: string | null;
  postalCode: string | null;
  country: string | null;
  employmentType: string | null;
  remote: "remote" | "hybrid" | "onsite" | null;
  url: string;
  publishedAt: string | null;
  salary: { min: number | null; max: number | null; currency: string | null; period: string | null } | null;
};

/** L'identifiant fait partie de l'adresse appelée : format strict (pas d'injection d'URL). */
export const BOARD_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

/** Accepte un identifiant ou l'adresse de la page carrières, et en déduit l'outil + l'identifiant. */
export function parseCareersInput(input: string): { ats: AtsKind; boardKey: string } | null {
  const s = input.trim();
  const patterns: Array<[RegExp, AtsKind]> = [
    [/^https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#]+)/i, "greenhouse"],
    [/^https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/i, "greenhouse"],
    [/^https?:\/\/jobs(?:\.eu)?\.lever\.co\/([^/?#]+)/i, "lever"],
    [/^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i, "ashby"],
    [/^https?:\/\/([^./]+)\.recruitee\.com/i, "recruitee"],
  ];
  for (const [re, ats] of patterns) {
    const m = s.match(re);
    if (m && BOARD_KEY_RE.test(decodeURIComponent(m[1]!))) return { ats, boardKey: decodeURIComponent(m[1]!) };
  }
  return null;
}

async function getJson(fetch: FetchLike, url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new SourceHttpError(`HTTP ${res.status}`, res.status);
  return res.json();
}

type Any = Record<string, any>; // réponses externes : lues prudemment champ par champ

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function remoteFrom(v: unknown): AtsPosting["remote"] {
  const t = String(v ?? "").toLowerCase();
  if (/remote|teletravail|télétravail/.test(t)) return "remote";
  if (/hybrid/.test(t)) return "hybrid";
  if (/on-?site|onsite|office/.test(t)) return "onsite";
  return null;
}

export async function fetchGreenhouse(fetch: FetchLike, c: CompanyTarget): Promise<AtsPosting[]> {
  const data = (await getJson(fetch, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.boardKey)}/jobs?content=true`)) as Any;
  return ((data.jobs ?? []) as Any[]).map((j) => ({
    ats: "greenhouse",
    boardKey: c.boardKey,
    companyName: c.name,
    id: String(j.id),
    title: String(j.title ?? ""),
    description: String(j.content ?? ""),
    descriptionIsHtml: true,
    location: str(j.location?.name),
    postalCode: null,
    country: null,
    employmentType: null,
    remote: remoteFrom(j.location?.name),
    url: String(j.absolute_url ?? ""),
    publishedAt: str(j.first_published) ?? str(j.updated_at),
    salary: null,
  }));
}

export async function fetchLever(fetch: FetchLike, c: CompanyTarget): Promise<AtsPosting[]> {
  const key = encodeURIComponent(c.boardKey);
  let data: unknown;
  try {
    data = await getJson(fetch, `https://api.lever.co/v0/postings/${key}?mode=json`);
  } catch (err) {
    // Les comptes européens sont sur une autre adresse.
    if (err instanceof SourceHttpError && err.status === 404) data = await getJson(fetch, `https://api.eu.lever.co/v0/postings/${key}?mode=json`);
    else throw err;
  }
  return ((data as Any[]) ?? []).map((j) => {
    const lists = ((j.lists ?? []) as Any[]).map((l) => `<h3>${l.text ?? ""}</h3>${l.content ?? ""}`).join("");
    const range = j.salaryRange as Any | undefined;
    return {
      ats: "lever" as const,
      boardKey: c.boardKey,
      companyName: c.name,
      id: String(j.id),
      title: String(j.text ?? ""),
      description: `<p>${String(j.descriptionPlain ?? "")}</p>${lists}<p>${String(j.additionalPlain ?? "")}</p>`,
      descriptionIsHtml: true,
      location: str(j.categories?.location),
      postalCode: null,
      country: str(j.country),
      employmentType: str(j.categories?.commitment),
      remote: remoteFrom(j.workplaceType),
      url: String(j.hostedUrl ?? ""),
      publishedAt: typeof j.createdAt === "number" ? new Date(j.createdAt).toISOString() : null,
      salary: range
        ? { min: num(range.min), max: num(range.max), currency: str(range.currency), period: /year/i.test(String(range.interval)) ? "year" : str(range.interval) }
        : null,
    };
  });
}

export async function fetchAshby(fetch: FetchLike, c: CompanyTarget): Promise<AtsPosting[]> {
  const data = (await getJson(fetch, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.boardKey)}?includeCompensation=true`)) as Any;
  return ((data.jobs ?? []) as Any[])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const addr = j.address?.postalAddress as Any | undefined;
      const salary = ((j.compensation?.summaryComponents ?? []) as Any[]).find((s) => s.compensationType === "Salary");
      return {
        ats: "ashby" as const,
        boardKey: c.boardKey,
        companyName: c.name,
        id: String(j.id),
        title: String(j.title ?? ""),
        description: String(j.descriptionPlain ?? ""),
        descriptionIsHtml: false,
        location: [str(addr?.addressLocality), str(j.location)].filter(Boolean).join(", ") || null,
        postalCode: str(addr?.postalCode),
        country: str(addr?.addressCountry),
        employmentType: str(j.employmentType),
        remote: j.isRemote === true ? "remote" : remoteFrom(j.workplaceType),
        url: String(j.jobUrl ?? ""),
        publishedAt: str(j.publishedAt),
        salary: salary
          ? { min: num(salary.minValue), max: num(salary.maxValue), currency: str(salary.currencyCode), period: /year/i.test(String(salary.interval)) ? "year" : str(salary.interval) }
          : null,
      };
    });
}

export async function fetchRecruitee(fetch: FetchLike, c: CompanyTarget): Promise<AtsPosting[]> {
  const data = (await getJson(fetch, `https://${encodeURIComponent(c.boardKey)}.recruitee.com/api/offers/`)) as Any;
  return ((data.offers ?? []) as Any[]).map((o) => ({
    ats: "recruitee" as const,
    boardKey: c.boardKey,
    companyName: c.name,
    id: String(o.id),
    title: String(o.title ?? ""),
    description: `${String(o.description ?? "")}${String(o.requirements ?? "")}`,
    descriptionIsHtml: true,
    location: str(o.location) ?? str(o.city),
    postalCode: str(o.postal_code),
    country: str(o.country_code) ?? str(o.country),
    employmentType: str(o.employment_type_code),
    remote: o.remote === true ? "remote" : o.hybrid === true ? "hybrid" : null,
    url: String(o.careers_url ?? ""),
    publishedAt: str(o.published_at),
    salary: o.salary ? { min: num(o.salary.min), max: num(o.salary.max), currency: str(o.salary.currency), period: str(o.salary.period) } : null,
  }));
}

export const ATS_FETCHERS: Record<AtsKind, (fetch: FetchLike, c: CompanyTarget) => Promise<AtsPosting[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  recruitee: fetchRecruitee,
};
