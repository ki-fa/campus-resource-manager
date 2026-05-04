import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urljoin

from bs4 import BeautifulSoup


ROOT_DIR = Path(__file__).resolve().parent
RAW_DIR = ROOT_DIR / "output" / "raw"
PARSED_DIR = ROOT_DIR / "output" / "parsed"

# Drop content blocks/headings that show up on at least this fraction of
# pages on the same site. They are almost certainly templated chrome
# (footer, sidebar, contact card) rather than real page content.
CORPUS_BOILERPLATE_RATIO = 0.6
CORPUS_BOILERPLATE_MIN_PAGES = 3

BOILERPLATE_TEXT_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"^primary navigation$",
        r"^explore$",
        r"^campus contact information$",
        r"^campus[- ]wide social media navigation$",
        r"^compliance links$",
        r"^colleges & majors$",
        r"^meet us icon$",
        r"^skip to main content$",
        r"^inside sac state$",
        r"^experience sac state$",
        r"^breadcrumb navigation$",
        r"^student life$",
        r"^academics$",
        r"^athletics$",
        r"^directory$",
        r"^careers$",
        r"^give$",
        r"^apply$",
        r"^menu$",
        r"^search$",
        r"^translate$",
        r"^sign in$",
        r"^my sac state$",
        r"^cookie settings$",
    ]
]

BOILERPLATE_LINK_TEXT_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"^apply$",
        r"^apply online$",
        r"^give$",
        r"^menu$",
        r"^search$",
        r"^translate$",
        r"^sign in$",
        r"^my sac state$",
        r"^cookie settings$",
        r"^accessibility statement$",
        r"^privacy statement$",
        r"^title ix$",
        r"^compliance$",
        r"^california state university$",
        r"^visit sac state at .+$",
        r"^visit state state at .+$",
        r"^skip to main content$",
        r"^submit your search request$",
        r"^skip to content$",
        r"^comments$",
        r"^wscuc$",
        r"^campus safety$",
        r"^parenting students$",
    ]
]

BOILERPLATE_LINK_URL_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"^https?://(?:www\.)?facebook\.com/",
        r"^https?://(?:www\.)?twitter\.com/",
        r"^https?://(?:www\.)?x\.com/",
        r"^https?://(?:www\.)?instagram\.com/",
        r"^https?://(?:www\.)?linkedin\.com/",
        r"^https?://(?:www\.)?youtube\.com/",
        r"^https?://(?:www\.)?tiktok\.com/",
        r"^https?://(?:www\.)?flickr\.com/",
        r"/cookie-settings",
        r"/accessibility-?statement",
        r"/privacy-?statement",
        r"/title-?ix",
        r"/compliance",
    ]
]

# Reject content blocks like "Specialty & Interests: ...", "Phone: ...",
# "Office Hours: ..." when picking a description -- they're directory
# row labels, not narrative summaries of the page.
NOISY_DESCRIPTION_PREFIX_RE = re.compile(
    r"^(specialty|phone|location|email|office|hours|website|address|fax|"
    r"building|room|contact|tel|telephone|mailing|category|categories|"
    r"department|major|program|degree|deadline|posted|published|updated)"
    r"[^:\n]{0,40}:",
    re.IGNORECASE,
)

# More general label-value catcher for anything we missed above.
LABEL_VALUE_RE = re.compile(r"^[A-Z][A-Za-z &/]{1,30}:\s*\S")


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def looks_like_boilerplate(value: str) -> bool:
    if not value:
        return True
    return any(pattern.match(value) for pattern in BOILERPLATE_TEXT_PATTERNS)


def is_boilerplate_link(text: str, url: str) -> bool:
    if text and any(pattern.match(text) for pattern in BOILERPLATE_LINK_TEXT_PATTERNS):
        return True
    if url and any(pattern.search(url) for pattern in BOILERPLATE_LINK_URL_PATTERNS):
        return True
    return False


def page_base_for_resolution(page_url: str) -> str:
    """Return a URL suitable as the base for resolving relative hrefs.

    Pages whose path has no trailing slash and no file extension in their
    last segment (e.g. ``.../meet-us``) are treated as directories so that a
    relative href like ``index.html`` resolves to ``.../meet-us/index.html``
    instead of overwriting ``meet-us`` and pointing at the parent directory.
    """
    if not page_url:
        return page_url
    parsed = urlparse(page_url)
    path = parsed.path or "/"
    if path.endswith("/"):
        return page_url
    last_segment = path.rsplit("/", 1)[-1]
    if "." in last_segment:
        return page_url
    return parsed._replace(path=path + "/").geturl()


def pick_description(
    meta_description: str,
    content_blocks: list,
    headings: list,
    title: str,
) -> str:
    cleaned_meta = normalize_whitespace(meta_description)
    if cleaned_meta and len(cleaned_meta) >= 30:
        return cleaned_meta

    for block in content_blocks:
        text = normalize_whitespace(block)
        if (
            len(text) >= 60
            and not NOISY_DESCRIPTION_PREFIX_RE.match(text)
            and not LABEL_VALUE_RE.match(text)
            and not looks_like_boilerplate(text)
            and text.lower() != normalize_whitespace(title).lower()
        ):
            return text

    if cleaned_meta:
        return cleaned_meta

    # Pages whose content is all "Label: value" rows (e.g. directory pages)
    # have no narrative paragraph to describe them. Returning an empty string
    # lets the frontend render its own "No summary available." fallback rather
    # than picking a misleading row from the data.
    return ""


# Page-type detection: a small classifier that labels each page so the
# frontend (and future per-type extractors) can render and search it more
# meaningfully than a flat bag of paragraphs. Step 1 of Tier 2 only adds
# the label; Steps 2+ will add type-specific extractors.
#
# Hints are matched against the URL path tokenized on /, -, _, and .,
# so e.g. "clubs" matches both "/clubs" and "/art-clubs.html".
DIRECTORY_PATH_HINTS = frozenset({
    "meet-us",
    "meet",
    "faculty",
    "staff",
    "people",
    "our-team",
})

LISTING_PATH_HINTS = frozenset({
    "programs",
    "courses",
    "forms",
    "faq",
    "scholarships",
    "clubs",
    "organizations",
    "employment",
    "opportunities",
    "internships",
    "academic-programs",
    "events",
    "calendar",
})

PATH_TOKEN_RE = re.compile(r"[/_.]+|(?<=[a-z])-(?=[a-z])")


def _path_tokens(path: str) -> list[str]:
    """Split a URL path into lower-case tokens for keyword matching.

    Hyphens between letters are treated as word boundaries so that filenames
    like ``art-clubs.html`` yield tokens ``['art', 'clubs', 'html']``.
    """
    return [token for token in PATH_TOKEN_RE.split(path.lower()) if token]


def _path_contains_keyword(tokens: list[str], keywords) -> bool:
    """True if any keyword (possibly multi-word, joined with -) is in tokens."""
    if not tokens:
        return False
    token_set = set(tokens)
    joined = "-".join(tokens)
    for keyword in keywords:
        if "-" in keyword:
            if keyword in joined:
                return True
        elif keyword in token_set:
            return True
    return False


def detect_page_type(url: str) -> str:
    """Classify a page from its URL path.

    Returns one of: ``directory``, ``event``, ``listing``, ``overview``.
    Order matters: a path that contains a directory hint is always a
    directory even if it also contains a listing keyword. Event detail
    pages (subpaths under ``/events/``) are distinguished from event-listing
    pages (just ``/events``) so a future extractor can treat them differently.
    """
    if not url:
        return "overview"

    path = urlparse(url).path.lower()
    tokens = _path_tokens(path)

    if _path_contains_keyword(tokens, DIRECTORY_PATH_HINTS):
        return "directory"

    if "/events/" in path or "/calendar/" in path:
        return "event"

    if _path_contains_keyword(tokens, LISTING_PATH_HINTS):
        return "listing"

    return "overview"


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
        if len(text) < min_length:
            continue
        if looks_like_boilerplate(text):
            continue
        blocks.append(text)
    return dedupe_list(blocks, lambda item: item.lower())


def sanitize_headings(headings: list) -> list:
    cleaned = []
    for heading in headings:
        text = normalize_whitespace(heading)
        if len(text) <= 2:
            continue
        if looks_like_boilerplate(text):
            continue
        cleaned.append(text)
    return dedupe_list(cleaned, lambda item: item.lower())


def extract_links(root, site_config: dict, page_url: str) -> list[dict]:
    links = []
    allowed_domains = set(site_config.get("allowedDomains", []))
    base_url = page_base_for_resolution(page_url) if page_url else ""

    for anchor in root.select("a[href]"):
        href = normalize_whitespace(anchor.get("href", ""))
        text = normalize_whitespace(anchor.get_text(" ", strip=True))
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue

        if base_url:
            try:
                resolved = urljoin(base_url, href)
            except ValueError:
                continue
        else:
            resolved = href

        parsed = urlparse(resolved)

        # mailto:/tel: links keep their scheme; everything else needs a host.
        if parsed.scheme in {"mailto", "tel"}:
            if is_boilerplate_link(text, resolved):
                continue
            links.append(
                {
                    "url": resolved,
                    "text": text,
                    "hash": text_hash(resolved, text),
                }
            )
            continue

        if not parsed.netloc:
            continue
        if allowed_domains and parsed.netloc not in allowed_domains:
            continue
        if is_boilerplate_link(text, resolved):
            continue

        links.append(
            {
                "url": resolved,
                "text": text,
                "hash": text_hash(resolved, text),
            }
        )
    return dedupe_list(links, lambda item: item["hash"])


# Tier 2 directory extractor. Targets the CSUS "Meet Us" template:
#   <h2 id="...">Group Name</h2>            -- ignored if class includes sr-only
#   <div class="group-member faculty-...">
#     <h3>Person Name</h3>
#     <p class="job-title">Role</p>
#     <ul class="contact-block">
#       <li class="location"><span>Location:</span> RVR 3018G</li>
#       <li class="phone"><span>Phone:</span> (916) 278-7628</li>
#       <li class="email"><a href="mailto:...">...</a></li>
#       <li class="website"><a href="...">Website</a></li>
#     </ul>
#     <ul class="sec-info-block">
#       <li><span class="member-about-header">Specialty & Interests:</span> ...</li>
#     </ul>
#   </div>
INTERESTS_PREFIX_RE = re.compile(
    r"^\s*(?:specialty\s*(?:&|and)?\s*interests?|areas?\s+of\s+teaching|"
    r"research\s+interests?|teaching\s+focus|areas?\s+of\s+expertise)\s*:\s*",
    re.IGNORECASE,
)


def _mailto_email(href: str) -> str:
    h = normalize_whitespace(href)
    if not h.startswith("mailto:"):
        return ""
    return h.split(":", 1)[1].split("?")[0].strip()


def _strip_li_label_prefix(li) -> str:
    full = normalize_whitespace(li.get_text(" ", strip=True))
    span = li.find("span")
    if not span:
        return full
    lab = normalize_whitespace(span.get_text(" ", strip=True))
    if lab and full.lower().startswith(lab.lower()):
        return full[len(lab) :].strip()
    return full


def _person_from_group_member(block, page_url: str):
    name_el = block.select_one("h3")
    name = normalize_whitespace(name_el.get_text(" ", strip=True)) if name_el else ""
    if not name:
        return None

    role_el = block.select_one("p.job-title, .job-title")
    role = normalize_whitespace(role_el.get_text(" ", strip=True)) if role_el else ""

    base = page_base_for_resolution(page_url) if page_url else ""
    person: dict = {"name": name}
    if role:
        person["role"] = role

    contact = block.select_one("ul.contact-block")
    if contact:
        for li in contact.select("li"):
            classes = " ".join(li.get("class", [])).lower()
            val = _strip_li_label_prefix(li)
            if "email" in classes:
                a = li.select_one("a[href^='mailto:']")
                if a:
                    em = _mailto_email(a.get("href", ""))
                    if em:
                        person["email"] = em
            elif "phone" in classes:
                a = li.select_one("a[href^='tel:']")
                if a:
                    href = normalize_whitespace(a.get("href", ""))
                    person["phone"] = href[4:].strip() if href.startswith("tel:") else val
                elif val:
                    person["phone"] = val
            elif "location" in classes and val:
                person["location"] = val
            elif "website" in classes:
                a = li.select_one("a[href]")
                if a:
                    href = normalize_whitespace(a.get("href", ""))
                    if href:
                        if href.startswith(("http://", "https://", "mailto:", "tel:")):
                            person["website"] = href
                        elif base:
                            try:
                                person["website"] = urljoin(base, href)
                            except ValueError:
                                person["website"] = href

    sec = block.select_one("ul.sec-info-block")
    if sec:
        interest_parts = []
        for li in sec.select("li"):
            raw = normalize_whitespace(li.get_text(" ", strip=True))
            cleaned = INTERESTS_PREFIX_RE.sub("", raw).strip()
            if cleaned:
                interest_parts.append(cleaned)
        if interest_parts:
            person["interests"] = " ".join(interest_parts)

    return person


def _group_name_for_member(block) -> str:
    h2 = block.find_previous("h2")
    while h2 is not None:
        cls = " ".join(h2.get("class", [])).lower()
        if "sr-only" not in cls:
            return normalize_whitespace(h2.get_text(" ", strip=True))
        h2 = h2.find_previous("h2")
    return ""


def extract_directory(root, page_url: str):
    """Return ``{"groups": [{"name": str, "people": [dict]}]}`` for CSUS Meet Us pages.

    Walks ``.group-member`` blocks under the chosen content root, grouping by
    the closest preceding non-``sr-only`` ``<h2>``. Returns ``None`` if the
    template doesn't match so the rest of the pipeline runs unchanged.
    """
    members = root.select(".group-member")
    if not members:
        return None

    order: list[str] = []
    by_name: dict[str, list] = {}

    for block in members:
        person = _person_from_group_member(block, page_url)
        if not person:
            continue
        gname = _group_name_for_member(block) or "Directory"
        if gname not in by_name:
            by_name[gname] = []
            order.append(gname)
        by_name[gname].append(person)

    groups = [{"name": n, "people": by_name[n]} for n in order if by_name.get(n)]
    if not groups:
        return None
    return {"groups": groups}


def parse_page(page: dict, site_config: dict, crawl_defaults: dict) -> dict:
    selectors = site_config.get("contentSelectors") or crawl_defaults.get("contentSelectors", [])
    keywords = site_config.get("relevantKeywords") or []
    soup = BeautifulSoup(page.get("html", ""), "html.parser")
    root = choose_root(soup, selectors)
    headings = sanitize_headings(
        [node.get_text(" ", strip=True) for node in root.select("h1, h2, h3, h4")]
    )
    content_blocks = extract_content_blocks(root, crawl_defaults.get("minTextLength", 40))
    link_records = extract_links(root, site_config, page.get("url", ""))
    description = pick_description(
        page.get("metaDescription", ""),
        content_blocks,
        headings,
        page.get("title", ""),
    )
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

    page_type = detect_page_type(page.get("url", ""))
    record = {
        "id": page.get("id") or text_hash(page.get("url", ""), page.get("title", "")),
        "siteId": site_config["id"],
        "url": page.get("url"),
        "title": page.get("title"),
        "description": description,
        "pageType": page_type,
        "categories": categories,
        "headings": headings,
        "contentBlocks": content_blocks,
        "links": link_records,
    }
    if page_type == "directory":
        directory = extract_directory(root, page.get("url", ""))
        if directory:
            record["directory"] = directory
    return record


def remove_corpus_boilerplate(pages: list) -> list:
    """Drop content blocks and headings that appear on most pages of a site.

    These are typically navigation, footer, or sidebar fragments that the
    per-page extractors couldn't filter on their own. The threshold is
    deliberately statistical -- if the same paragraph shows up on most pages
    of a site, it is by definition templated chrome rather than real content.
    """
    if len(pages) < CORPUS_BOILERPLATE_MIN_PAGES:
        return pages

    block_counts: dict[str, int] = defaultdict(int)
    heading_counts: dict[str, int] = defaultdict(int)
    for page in pages:
        seen_blocks = set()
        for block in page.get("contentBlocks", []):
            key = block.lower()
            if key in seen_blocks:
                continue
            seen_blocks.add(key)
            block_counts[key] += 1
        seen_headings = set()
        for heading in page.get("headings", []):
            key = heading.lower()
            if key in seen_headings:
                continue
            seen_headings.add(key)
            heading_counts[key] += 1

    threshold = max(2, int(len(pages) * CORPUS_BOILERPLATE_RATIO))
    boilerplate_blocks = {key for key, count in block_counts.items() if count >= threshold}
    boilerplate_headings = {key for key, count in heading_counts.items() if count >= threshold}

    if not boilerplate_blocks and not boilerplate_headings:
        return pages

    cleaned_pages = []
    for page in pages:
        cleaned = dict(page)
        if boilerplate_blocks:
            cleaned["contentBlocks"] = [
                block
                for block in page.get("contentBlocks", [])
                if block.lower() not in boilerplate_blocks
            ]
        if boilerplate_headings:
            cleaned["headings"] = [
                heading
                for heading in page.get("headings", [])
                if heading.lower() not in boilerplate_headings
            ]
        # Re-pick description in case the prior choice was a now-stripped block.
        if cleaned.get("description", "").lower() in boilerplate_blocks:
            cleaned["description"] = pick_description(
                "",
                cleaned["contentBlocks"],
                cleaned["headings"],
                cleaned.get("title", ""),
            )
        cleaned_pages.append(cleaned)

    return cleaned_pages


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
        pages = remove_corpus_boilerplate(pages)
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
