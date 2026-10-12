"""Indeed France via JobSpy (python-jobspy, MIT), exporté au format JobOffer de JobScraper.

Mêmes options que `main.py search` de JobScraper : le connecteur jobscraper:indeed l'appelle à sa place.
"""
import argparse
import json
import math
from datetime import date, datetime, timezone

from jobspy import scrape_jobs  # en tête : « --help » (diagnostic) échoue si JobSpy n'est pas installé

# Heures annuelles légales en France (35 h) : convertit un taux horaire en salaire annuel.
PER_YEAR = {"yearly": 1, "monthly": 12, "weekly": 52, "daily": 218, "hourly": 1607}
HOURS = {"past_24h": 24, "past_week": 168, "past_month": 720}


def value(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v


def to_offer(row, scraped_at):
    """Une ligne JobSpy → JobOffer (champs lus par packages/job-normalizer/src/jobscraper.ts)."""
    factor = PER_YEAR.get(value(row.get("interval")) or "")
    lo, hi = value(row.get("min_amount")), value(row.get("max_amount"))
    posted = value(row.get("date_posted"))
    return {
        "id": row["id"],
        "source": "indeed",
        "url": row["job_url"],
        "title": row["title"],
        "company": value(row.get("company")),
        "location": value(row.get("location")),
        "description": value(row.get("description")),
        "salary_min": round(lo * factor) if lo is not None and factor else None,
        "salary_max": round(hi * factor) if hi is not None and factor else None,
        "salary_currency": value(row.get("currency")) or "EUR",
        "contract_type": value(row.get("job_type")),
        # JobSpy met False quand l'annonce ne parle pas de télétravail : ce n'est pas « sur site ».
        "remote": True if value(row.get("is_remote")) is True else None,
        "posted_at": posted.isoformat() if isinstance(posted, (date, datetime)) else value(posted),
        "scraped_at": scraped_at,
        "skills": [],
        "benefits": [],
        "apply_url": value(row.get("job_url_direct")),
    }


def main():
    parser = argparse.ArgumentParser(description="Recherche Indeed France (JobSpy) → JSON JobOffer")
    parser.add_argument("command", nargs="?", default="search")
    parser.add_argument("--keywords", required=True)
    parser.add_argument("--location", default="France")
    parser.add_argument("--date", default="any_time")
    parser.add_argument("--max-results", type=int, default=25)
    parser.add_argument("--output", required=True)
    args, _ = parser.parse_known_args()  # --source, --sort, --format : propres à JobScraper
    df = scrape_jobs(
        site_name=["indeed"],
        search_term=args.keywords,
        location=args.location,
        country_indeed="France",
        results_wanted=args.max_results,
        hours_old=HOURS.get(args.date),
    )
    scraped_at = datetime.now(timezone.utc).isoformat()
    offers = [to_offer(row, scraped_at) for row in df.to_dict("records")]
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(offers, f, ensure_ascii=False)
    print(f"{len(offers)} offres Indeed")


if __name__ == "__main__":
    main()
