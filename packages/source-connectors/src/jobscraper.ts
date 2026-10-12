import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { SourceUnavailableError, type JobSource, type RawJob, type SearchParams, type SourceHealth } from "./types";

const execFileAsync = promisify(execFile);
export const JOBSCRAPER_PROVIDERS = ["linkedin", "hellowork", "francetravail", "wttj", "adzuna", "indeed"] as const;
export type JobScraperProvider = (typeof JOBSCRAPER_PROVIDERS)[number];

export const JOBSCRAPER_MAX_PER_SEARCH = 25;

/** Sites collectés. France Travail et Adzuna : déjà couverts par leurs API (les offres déjà importées restent lisibles). */
export const JOBSCRAPER_COLLECTED = ["linkedin", "hellowork", "wttj", "indeed"] as const satisfies readonly JobScraperProvider[];

export const JOBSCRAPER_SOURCE_NAMES: string[] = JOBSCRAPER_COLLECTED.map((provider) => `jobscraper:${provider}`);

export function isJobScraperNoResultsOutput(output: string): boolean {
  return /aucune offre trouv|aucun resultat|no jobs found/i.test(output.normalize("NFD").replace(/\p{Diacritic}/gu, ""));
}

export const JobScraperOfferSchema = z.object({
  id: z.string().min(1),
  source: z.enum(JOBSCRAPER_PROVIDERS),
  url: z.string().url(),
  title: z.string().trim().min(1),
  // LinkedIn renvoie parfois une entreprise ou un lieu vide : l'offre reste exploitable.
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  salary_min: z.number().nullable().optional(),
  salary_max: z.number().nullable().optional(),
  salary_currency: z.string().optional(),
  contract_type: z.string().nullable().optional(),
  experience_level: z.string().nullable().optional(),
  remote: z.boolean().nullable().optional(),
  posted_at: z.string().min(1).nullable().optional(),
  scraped_at: z.string().min(1).optional(),
  skills: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
}).passthrough();

export type JobScraperOffer = z.infer<typeof JobScraperOfferSchema>;

export function mapJobScraperOfferToRawJob(value: unknown, provider: JobScraperProvider, collectedAt = new Date()): RawJob | null {
  const parsed = JobScraperOfferSchema.safeParse(value);
  if (!parsed.success || parsed.data.source !== provider) return null;
  return {
    source: `jobscraper:${provider}`,
    sourceJobId: parsed.data.id,
    data: parsed.data,
    collectedAt,
  };
}

/** Lieu passé au site. Indeed ne reconnaît pas « Oise » seul (0 offre) mais « Oise (60) », son format « Nom (département) ». */
export function jobScraperLocation(provider: JobScraperProvider, params: SearchParams): string {
  const label = params.locationLabel || params.department || "France";
  return provider === "indeed" && params.locationLabel && params.department && !/\(\d/.test(label)
    ? `${label} (${params.department})`
    : label;
}

export type BlockCheck ={ status: "OK" | "BLOCKED" | "UNREACHABLE" | "UNCHECKED"; detail: string };

const SITE_NAMES: Record<JobScraperProvider, string> = {
  linkedin: "LinkedIn",
  hellowork: "HelloWork",
  francetravail: "France Travail",
  wttj: "Welcome to the Jungle",
  adzuna: "Adzuna",
  indeed: "Indeed",
};

/**
 * Ce qu'une page de résultats saine contient (les liens/cartes que JobScraper lit lui-même).
 * Indispensable : une page LinkedIn normale contient aussi le mot « captcha ».
 */
const RESULTS_MARKER: Partial<Record<JobScraperProvider, RegExp>> = {
  linkedin: /base-search-card/,
  hellowork: /\/fr-fr\/emplois\/\d+\.html/,
  francetravail: /\/offres\/recherche\/detail\//,
  wttj: /"hits"\s*:/,
};

/** Pages anti-robot (Cloudflare, DataDome, PerimeterX) ou mur de connexion LinkedIn. */
const BLOCK_PAGE = /captcha|cf-chl|challenge-platform|just a moment|datadome|authwall|unusual activity|activit[ée] inhabituelle/i;

/** Lit une réponse HTTP d'un site : blocage d'IP (429, 999 LinkedIn, 403), page anti-robot, ou OK. */
export function classifyProbe(provider: JobScraperProvider, status: number, finalUrl: string, body: string): BlockCheck {
  const site = SITE_NAMES[provider];
  if (status === 429) return { status: "BLOCKED", detail: `${site} limite tes requêtes (HTTP 429 : trop de requêtes)` };
  if (status === 999 || status === 403 || status === 451) return { status: "BLOCKED", detail: `${site} refuse l'accès à ton IP (HTTP ${status})` };
  if (status >= 400) return { status: "UNREACHABLE", detail: `${site} répond HTTP ${status}` };
  if (RESULTS_MARKER[provider]?.test(body)) return { status: "OK", detail: `${site} accessible` };
  if (/authwall|\/login|checkpoint/i.test(finalUrl) || BLOCK_PAGE.test(body)) {
    return { status: "BLOCKED", detail: `${site} affiche une vérification anti-robot ou une page de connexion au lieu des offres` };
  }
  return { status: "UNREACHABLE", detail: `${site} : page sans offres (site modifié, ou blocage silencieux)` };
}

/** Une requête (celle que ferait JobScraper) depuis ce PC : dit si le site bloque ton IP. */
export async function probeJobScraperSite(provider: JobScraperProvider, fetchImpl: typeof fetch = fetch): Promise<BlockCheck> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  };
  const requests: Partial<Record<JobScraperProvider, [string, RequestInit]>> = {
    linkedin: ["https://www.linkedin.com/jobs/search?keywords=developpeur&location=France", { headers }],
    hellowork: ["https://www.hellowork.com/fr-fr/emploi/recherche.html?k=developpeur", { headers }],
    francetravail: ["https://candidat.francetravail.fr/offres/recherche?motsCles=developpeur", { headers }],
    // Index de recherche public utilisé par le site WTTJ (mêmes identifiants que JobScraper).
    wttj: [
      "https://csekhvms53-dsn.algolia.net/1/indexes/wttj_jobs_production_fr/query",
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Algolia-API-Key": "4bd8f6215d0cc52b26430765769e65a0",
          "X-Algolia-Application-Id": "CSEKHVMS53",
          Referer: "https://www.welcometothejungle.com/",
          Origin: "https://www.welcometothejungle.com",
        },
        body: JSON.stringify({ query: "developpeur", hitsPerPage: 1 }),
      },
    ],
  };
  const request = requests[provider];
  // Adzuna : API à clé. Indeed : API mobile appelée par JobSpy, qui journalise lui-même un refus (HTTP 403…).
  if (!request) return { status: "UNCHECKED", detail: `${SITE_NAMES[provider]} : pas de page à sonder pour un blocage d'IP` };
  try {
    const res = await fetchImpl(request[0], { ...request[1], redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return classifyProbe(provider, res.status, res.url, await res.text());
  } catch (error) {
    return { status: "UNREACHABLE", detail: `${SITE_NAMES[provider]} injoignable (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** Page publique LinkedIn d'une offre close : bandeau « Les candidatures ne sont plus acceptées ». */
const LINKEDIN_CLOSED = /closed-job__flavor--closed/;

/**
 * L'offre LinkedIn accepte-t-elle encore des candidatures ? (page publique, sans compte, celle que lit JobScraper)
 * true = ouverte, false = close ou supprimée, null = impossible à savoir (blocage, réseau).
 */
export async function linkedinJobIsOpen(sourceJobId: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const id = sourceJobId.match(/\d{6,}/)?.[0];
  if (!id) return null;
  try {
    const res = await fetchImpl(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 410) return false;
    if (res.status !== 200) return null;
    return !LINKEDIN_CLOSED.test(await res.text());
  } catch {
    return null;
  }
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

export type PageDetails = { description: string | null; postedAt: Date | null };

const AGE_UNITS: Array<[RegExp, number]> = [
  [/^(minute|min)/, 60_000],
  [/^(heure|hour|h$)/, 3_600_000],
  [/^(jour|day|j$)/, 86_400_000],
  [/^(semaine|week)/, 7 * 86_400_000],
  [/^(mois|month)/, 30 * 86_400_000],
];

/** « il y a 41 minutes », « il y a 1 semaine », « 2 days ago » → date approximative de publication. */
export function relativeAge(text: string, now = new Date()): Date | null {
  const m = text.toLowerCase().match(/(\d+)\s*([a-z]+)/);
  if (!m) return null;
  const unit = AGE_UNITS.find(([re]) => re.test(m[2]!));
  return unit ? new Date(now.getTime() - Number(m[1]) * unit[1]) : null;
}

/**
 * Description (HTML) et date de publication d'une page d'offre : données schema.org « JobPosting » (format lu par
 * Google pour l'emploi : HelloWork et beaucoup d'autres), sinon page publique LinkedIn (bloc de description,
 * « il y a 3 jours »).
 */
export function detailsFromPage(html: string, now = new Date()): PageDetails {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld(?:\+|&#x2B;|&#43;)json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(m[1]!);
      const items = (Array.isArray(data) ? data : [data]).flatMap((d) => (d && typeof d === "object" && "@graph" in d ? (d["@graph"] as unknown[]) : [d]));
      const posting = items.find((d): d is { description?: unknown; datePosted?: unknown } =>
        !!d && typeof d === "object" && (d as { "@type"?: unknown })["@type"] === "JobPosting",
      );
      if (!posting) continue;
      const posted = typeof posting.datePosted === "string" ? new Date(posting.datePosted) : null;
      return {
        description: typeof posting.description === "string" && posting.description.trim() ? posting.description : null,
        postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
      };
    } catch {
      // JSON invalide : on essaie le bloc suivant.
    }
  }
  const age = html.match(/posted-time-ago__text[^>]*>\s*([^<]+?)\s*</)?.[1];
  return {
    description: html.match(/<div class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]?.trim() || null,
    postedAt: age ? relativeAge(age, now) : null,
  };
}

/** Page publique d'une offre JobScraper (LinkedIn : version sans compte, plus légère). */
function detailUrl(source: string, sourceJobId: string, sourceUrl: string): string {
  const linkedinId = source === "jobscraper:linkedin" ? sourceJobId.match(/\d{6,}/)?.[0] : undefined;
  return linkedinId ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedinId}` : sourceUrl;
}

/**
 * WTTJ : la page est derrière une vérification anti-robot (HTTP 202 + JavaScript), mais l'API publique de leur site
 * donne l'annonce entière (JobScraper n'en garde qu'un résumé de quelques lignes) et sa date de publication.
 */
async function wttjDetails(sourceUrl: string, fetchImpl: typeof fetch): Promise<PageDetails | null> {
  const m = sourceUrl.match(/\/companies\/([^/?#]+)\/jobs\/([^/?#]+)/);
  if (!m) return null;
  const res = await fetchImpl(`https://api.welcometothejungle.com/api/v1/organizations/${m[1]}/jobs/${m[2]}`, {
    headers: { ...BROWSER_HEADERS, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const { job } = (await res.json()) as { job?: { description?: string | null; profile?: string | null; published_at?: string | null } };
  const parts = [job?.description, job?.profile].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  const posted = job?.published_at ? new Date(job.published_at) : null;
  return { description: parts.length ? parts.join("\n") : null, postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null };
}

/** Description (HTML) et date de publication d'une offre JobScraper, lues sur sa page publique. null si page illisible. */
export async function fetchJobScraperDetails(
  link: { source: string; sourceJobId: string; sourceUrl: string },
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<PageDetails | null> {
  try {
    if (link.source === "jobscraper:wttj") return await wttjDetails(link.sourceUrl, fetchImpl);
    const res = await fetchImpl(detailUrl(link.source, link.sourceJobId, link.sourceUrl), {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? detailsFromPage(await res.text(), now) : null;
  } catch {
    return null;
  }
}

export type JobScraperOptions = {
  provider: JobScraperProvider;
  enabled?: boolean;
  path?: string;
  python?: string;
  timeoutMs?: number;
  /** Sonde de blocage (remplaçable dans les tests). */
  probe?: (provider: JobScraperProvider) => Promise<BlockCheck>;
};

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const INDEED_SCRIPT = path.resolve(import.meta.dirname, "../python/indeed.py");

export function createJobScraperSources(opts: Omit<JobScraperOptions, "provider"> = {}): JobScraperSource[] {
  return JOBSCRAPER_COLLECTED.map((provider) => new JobScraperSource({ ...opts, provider }));
}

/** Appelle la CLI officielle avec un fichier JSON temporaire ; chaque source a son propre état/erreur. */
export class JobScraperSource implements JobSource {
  readonly name: string;
  private readonly root: string;
  private readonly python: string;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  private lastProbe: { at: number; check: BlockCheck } | null = null;

  constructor(private readonly opts: JobScraperOptions) {
    this.name = `jobscraper:${opts.provider}`;
    this.root = path.resolve(PROJECT_ROOT, opts.path || "tools/jobscraper");
    this.python = opts.python || path.join(this.root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.enabled = opts.enabled ?? false;
  }

  private async run(args: string[]) {
    try {
      // Indeed : pas dans JobScraper → script JobSpy du dépôt, mêmes options et même format de sortie.
      const script = this.opts.provider === "indeed" ? INDEED_SCRIPT : path.join(this.root, "main.py");
      return await execFileAsync(this.python, [script, ...args], {
        cwd: this.root,
        // Le paquet est dans src/ : chemin donné ici, car l'installation « pip install -e » garde l'ancien chemin
        // du dossier quand le projet est déplacé ou renommé (→ « No module named 'jobscraper' »).
        env: { ...process.env, PYTHONPATH: path.join(this.root, "src") },
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SourceUnavailableError(`Python ou JobScraper introuvable. Vérifie JOBSCRAPER_PATH et JOBSCRAPER_PYTHON (Python attendu : ${this.python}).`);
      }
      throw error;
    }
  }

  /** Le site bloque-t-il ton IP ? Sondé au plus toutes les 5 min (pas de requête en plus à chaque recherche). */
  private async blockedBy(): Promise<BlockCheck | null> {
    if (!this.lastProbe || Date.now() - this.lastProbe.at > 5 * 60_000) {
      this.lastProbe = { at: Date.now(), check: await (this.opts.probe ?? probeJobScraperSite)(this.opts.provider) };
    }
    return this.lastProbe.check.status === "BLOCKED" ? this.lastProbe.check : null;
  }

  async search(params: SearchParams): Promise<RawJob[]> {
    if (!this.enabled) throw new SourceUnavailableError("JobScraper est désactivé (JOBSCRAPER_ENABLED=false).");
    const dir = await mkdtemp(path.join(os.tmpdir(), "job-radar-jobscraper-"));
    const output = path.join(dir, "jobs.json");
    const days = params.publishedSinceDays;
    // Sites scrapés, détail LinkedIn = 1 requête de plus par offre : 300 par recherche (comme les API) rendrait
    // une collecte interminable (coupée par le délai) et ferait bloquer l'IP. Tri par date : les plus récentes d'abord.
    const max = Math.min(params.maxResults ?? JOBSCRAPER_MAX_PER_SEARCH, JOBSCRAPER_MAX_PER_SEARCH);
    const date = days === undefined ? "any_time" : days <= 1 ? "past_24h" : days <= 7 ? "past_week" : "past_month";
    try {
      const { stdout, stderr } = await this.run([
        "search", "--keywords", params.keywords,
        "--location", jobScraperLocation(this.opts.provider, params),
        "--source", this.opts.provider,
        "--date", date,
        "--sort", "date",
        "--max-results", String(max),
        ...(this.opts.provider === "linkedin" ? ["--details"] : []),
        "--format", "json", "--output", output,
      ]);
      // Journal JobScraper « | ERROR | », JobSpy « - ERROR - ».
      const failed = /\|\s*ERROR\s*\||- ERROR - /i.test(stderr);
      let json: string;
      try {
        json = await readFile(output, "utf8");
      } catch (error) {
        if (failed) throw new Error(stderr.trim().slice(-500));
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && isJobScraperNoResultsOutput(stdout)) {
          await this.throwIfBlocked(); // « Aucune offre » peut cacher une page de connexion ou un captcha.
          return [];
        }
        throw error;
      }
      const data: unknown = JSON.parse(json);
      if (!Array.isArray(data)) throw new Error("JobScraper a renvoyé un JSON qui n'est pas une liste.");
      // Erreur loguée sans aucun résultat = panne ; avec des résultats, on garde ce qui est arrivé.
      if (failed && data.length === 0) throw new Error(stderr.trim().slice(-500));
      const collectedAt = new Date();
      const cutoff = days === undefined ? null : collectedAt.getTime() - days * 86_400_000;
      // Aucune offre : vraie recherche vide, ou site qui bloque sans le dire (page captcha, connexion…).
      if (data.length === 0) await this.throwIfBlocked();
      return data.flatMap((item) => {
        const raw = mapJobScraperOfferToRawJob(item, this.opts.provider, collectedAt);
        if (!raw) return [];
        const postedAt = (raw.data as JobScraperOffer).posted_at;
        if (cutoff !== null && postedAt && Date.parse(postedAt) < cutoff) return [];
        return [raw];
      }).sort((a, b) => {
        const ad = Date.parse((a.data as JobScraperOffer).posted_at ?? "");
        const bd = Date.parse((b.data as JobScraperOffer).posted_at ?? "");
        return (Number.isNaN(bd) ? -Infinity : bd) - (Number.isNaN(ad) ? -Infinity : ad);
      }).slice(0, max);
    } catch (error) {
      if (error instanceof SourceUnavailableError) throw error;
      await this.throwIfBlocked();
      if (error instanceof SyntaxError) throw new Error(`JSON JobScraper invalide (${this.opts.provider}).`);
      const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim().slice(-500) : "";
      throw new Error(`JobScraper ${this.opts.provider} : ${error instanceof Error ? error.message : String(error)}${detail ? ` — ${detail}` : ""}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** IP bloquée : on arrête ce site pour cette collecte (les autres recherches seraient bloquées aussi). */
  private async throwIfBlocked() {
    const blocked = await this.blockedBy();
    if (blocked) throw new SourceUnavailableError(`IP bloquée — ${blocked.detail}. Collecte de ce site suspendue jusqu'au prochain passage.`);
  }

  async healthCheck(): Promise<SourceHealth> {
    if (!this.enabled) return { status: "SOURCE_UNAVAILABLE", message: "JobScraper est désactivé." };
    try {
      await this.run(["--help"]);
      const check = await (this.opts.probe ?? probeJobScraperSite)(this.opts.provider);
      if (check.status === "BLOCKED" || check.status === "UNREACHABLE") return { status: "ERROR", message: check.detail };
      return { status: "OK" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "SOURCE_UNAVAILABLE", message: `JobScraper indisponible : ${message}` };
    }
  }
}
