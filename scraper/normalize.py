import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup


ROOT_DIR = Path(__file__).resolve().parent
RAW_DIR = ROOT_DIR / "output" / "raw"
PARSED_DIR = ROOT_DIR / "output" / "parsed"


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:80]


def text_hash(*parts: str) -> str:
    joined = "|".join(parts)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()


def dedupe_strings(values: list[str]) -> list[str]:
    unique = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


def normalize_config_shape(raw_config: dict) -> dict:
    legacy_defaults = raw_config.get("defaults", {})
    crawl_defaults = {**legacy_defaults, **raw_config.get("crawlDefaults", {})}
    crawl_defaults.pop("excludeUrlPatterns", None)
    crawl_defaults.pop("relevantKeywords", None)
    site_defaults = {
        "excludeUrlPatterns": dedupe_strings(
            [
                *legacy_defaults.get("excludeUrlPatterns", []),
                *raw_config.get("siteDefaults", {}).get("excludeUrlPatterns", []),
            ]
        ),
        "relevantKeywords": dedupe_strings(
            [
                *legacy_defaults.get("relevantKeywords", []),
                *raw_config.get("siteDefaults", {}).get("relevantKeywords", []),
            ]
        ),
    }
    return {
        "crawlDefaults": crawl_defaults,
        "siteDefaults": site_defaults,
        "sites": raw_config.get("sites", []),
    }


def merge_site_config(site: dict, crawl_defaults: dict, site_defaults: dict) -> dict:
    return {
        **crawl_defaults,
        **site,
        "contentSelectors": site.get("contentSelectors") or crawl_defaults.get("contentSelectors", []),
        "relevantKeywords": dedupe_strings(
            [
                *site_defaults.get("relevantKeywords", []),
                *site.get("relevantKeywords", []),
            ]
        ),
        "excludeUrlPatterns": dedupe_strings(
            [
                *site_defaults.get("excludeUrlPatterns", []),
                *site.get("excludeUrlPatterns", []),
            ]
        ),
    }


def choose_root(soup: BeautifulSoup, selectors: list[str]):
    for selector in selectors:
        match = soup.select_one(selector)
        if match is not None:
            return match
    return soup.body or soup


def classify(categories_text: str, keywords: list[str]) -> list[str]:
    found = []
    haystack = categories_text.lower()
    for keyword in keywords:
        if keyword.lower() in haystack and keyword not in found:
            found.append(keyword)
    return found


def dedupe_list(items: list, key_builder):
    seen = set()
    unique = []
    for item in items:
        key = key_builder(item)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def extract_content_blocks(root, min_length: int) -> list[str]:
    blocks = []
    for node in root.select("p, li"):
        text = normalize_whitespace(node.get_text(" ", strip=True))
        if len(text) >= min_length:
            blocks.append(text)
    return dedupe_list(blocks, lambda item: item)


def extract_links(root, site_config: dict) -> list[dict]:
    links = []
    allowed_domains = set(site_config.get("allowedDomains", []))
    for anchor in root.select("a[href]"):
        href = normalize_whitespace(anchor.get("href", ""))
        text = normalize_whitespace(anchor.get_text(" ", strip=True))
        if not href:
            continue

        parsed = urlparse(href)
        if allowed_domains and parsed.netloc and parsed.netloc not in allowed_domains:
            continue

        links.append(
            {
                "url": href,
                "text": text,
                "hash": text_hash(href, text),
            }
        )
    return dedupe_list(links, lambda item: item["hash"])


def parse_page(page: dict, site_config: dict, crawl_defaults: dict) -> dict:
    selectors = site_config.get("contentSelectors") or crawl_defaults.get("contentSelectors", [])
    keywords = site_config.get("relevantKeywords") or []
    soup = BeautifulSoup(page.get("html", ""), "html.parser")
    root = choose_root(soup, selectors)
    headings = dedupe_list(
        [
            normalize_whitespace(node.get_text(" ", strip=True))
            for node in root.select("h1, h2, h3, h4")
        ],
        lambda item: item,
    )
    content_blocks = extract_content_blocks(root, crawl_defaults.get("minTextLength", 40))
    link_records = extract_links(root, site_config)
    description = page.get("metaDescription") or (content_blocks[0] if content_blocks else "")
    categories = classify(
        " ".join(
            [
                page.get("title", ""),
                description,
                " ".join(headings),
                " ".join(content_blocks[:8]),
            ]
        ),
        keywords,
    )

    return {
        "id": page.get("id") or text_hash(page.get("url", ""), page.get("title", "")),
        "siteId": site_config["id"],
        "url": page.get("url"),
        "title": page.get("title"),
        "description": description,
        "categories": categories,
        "headings": headings,
        "contentBlocks": content_blocks,
        "links": link_records,
    }


def load_config(config_path: Path) -> dict:
    with config_path.open("r", encoding="utf-8") as handle:
        return normalize_config_shape(json.load(handle))


def load_raw_files(raw_dir: Path) -> list[dict]:
    payloads = []
    for file_path in sorted(raw_dir.glob("*.json")):
        with file_path.open("r", encoding="utf-8") as handle:
            payloads.append(json.load(handle))
    return payloads


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=True)


def count_categories(pages: list[dict]) -> dict:
    counts = defaultdict(int)
    for page in pages:
        for category in page.get("categories", []):
            counts[category] += 1
    return dict(sorted(counts.items()))


def build_outputs(config: dict, raw_payloads: list[dict]):
    crawl_defaults = config.get("crawlDefaults", {})
    site_defaults = config.get("siteDefaults", {})
    site_lookup = {
        site["id"]: merge_site_config(site, crawl_defaults, site_defaults)
        for site in config.get("sites", [])
    }
    combined_pages = []
    combined_links = []
    per_site_outputs = []

    for payload in raw_payloads:
        site_id = payload["siteId"]
        site_config = site_lookup.get(site_id, {"id": site_id, **crawl_defaults, **site_defaults})
        pages = [
            parse_page(page, site_config, crawl_defaults)
            for page in payload.get("pages", [])
            if page.get("url")
        ]
        pages = dedupe_list(pages, lambda item: item["url"])
        site_links = dedupe_list(
            [link for page in pages for link in page["links"]],
            lambda item: item["url"],
        )
        site_output = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "siteId": site_id,
            "label": payload.get("label", site_id),
            "pageCount": len(pages),
            "linkCount": len(site_links),
            "pages": pages,
            "links": site_links,
        }
        per_site_outputs.append((site_id, site_output))
        combined_pages.extend(pages)
        combined_links.extend(site_links)

    combined_pages = dedupe_list(combined_pages, lambda item: item["url"])
    combined_links = dedupe_list(combined_links, lambda item: item["url"])
    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "siteCount": len(per_site_outputs),
        "pageCount": len(combined_pages),
        "linkCount": len(combined_links),
        "categoryCounts": count_categories(combined_pages),
    }
    combined_output = {
        "summary": summary,
        "pages": combined_pages,
        "links": combined_links,
    }
    return combined_output, per_site_outputs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize crawler output into deduplicated JSON using BeautifulSoup."
    )
    parser.add_argument(
        "--config",
        default=str(ROOT_DIR / "config" / "university-sites.example.json"),
        help="Path to the scraper config JSON file.",
    )
    parser.add_argument(
        "--raw-dir",
        default=str(RAW_DIR),
        help="Directory containing raw crawler JSON files.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(PARSED_DIR),
        help="Directory where parsed JSON files should be written.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config(Path(args.config))
    raw_payloads = load_raw_files(Path(args.raw_dir))
    combined_output, per_site_outputs = build_outputs(config, raw_payloads)
    output_dir = Path(args.output_dir)

    write_json(output_dir / "resources.json", combined_output)
    for site_id, payload in per_site_outputs:
        write_json(output_dir / f"{slugify(site_id)}.json", payload)

    print(f"Wrote {len(per_site_outputs)} site files and 1 combined file to {output_dir}")


if __name__ == "__main__":
    main()
