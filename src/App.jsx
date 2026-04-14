import { useEffect, useMemo, useState } from "react";
import {
  collectCategories,
  filterPages,
  normalizePages,
  pickQuickCategories
} from "./lib/resourceData";

const AUTOLOAD_COMBINED_THRESHOLD = 120;

function parsePath(pathname) {
  if (pathname.startsWith("/resources/")) {
    return {
      pageType: "detail",
      pageId: decodeURIComponent(pathname.replace("/resources/", ""))
    };
  }
  if (pathname === "/resources") {
    return { pageType: "list", pageId: null };
  }
  return { pageType: "home", pageId: null };
}

function linkTo(pathname, onNavigate, className, children) {
  return (
    <a
      href={pathname}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(pathname);
      }}
    >
      {children}
    </a>
  );
}

function ResourceListCard({ page, onNavigate }) {
  return (
    <article className="resource-card">
      <div className="resource-card__header">
        <p>{page.siteId}</p>
        <span>{page.readingEstimate} min read</span>
      </div>
      <h3>{page.title}</h3>
      <p>{page.description}</p>
      <div className="chip-row">
        {page.categories?.slice(0, 3).map((category) => (
          <span className="chip" key={category}>
            {category}
          </span>
        ))}
      </div>
      {linkTo(`/resources/${encodeURIComponent(page.id)}`, onNavigate, "resource-card__link", "Read resource")}
    </article>
  );
}

function normalizeSiteId(siteId) {
  return siteId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function App() {
  const [{ pageType, pageId }, setRoute] = useState(parsePath(window.location.pathname));
  const [indexPayload, setIndexPayload] = useState(null);
  const [allPages, setAllPages] = useState([]);
  const [query, setQuery] = useState("");
  const [siteId, setSiteId] = useState("");
  const [category, setCategory] = useState("");
  const [linkType, setLinkType] = useState("");
  const [loading, setLoading] = useState(true);

  function navigate(pathname) {
    if (window.location.pathname === pathname) {
      return;
    }
    window.history.pushState({}, "", pathname);
    setRoute(parsePath(pathname));
  }

  useEffect(() => {
    function onPopState() {
      setRoute(parsePath(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadIndex() {
      setLoading(true);
      const indexResponse = await fetch("/api/resources/index");
      const indexData = await indexResponse.json();
      if (!active) return;

      setIndexPayload(indexData);

      if ((indexData.summary?.pageCount || 0) <= AUTOLOAD_COMBINED_THRESHOLD) {
        const combinedResponse = await fetch("/api/resources/combined");
        const combined = await combinedResponse.json();
        if (!active) return;
        setAllPages(normalizePages(combined.pages || []));
      } else if (indexData.sites?.length) {
        const firstSite = indexData.sites[0].siteId;
        const siteResponse = await fetch(`/api/resources/site/${encodeURIComponent(firstSite)}`);
        const siteData = await siteResponse.json();
        if (!active) return;
        setAllPages(normalizePages(siteData.pages || []));
      }
      setLoading(false);
    }

    loadIndex().catch((error) => {
      console.error("Failed to load resources index", error);
      if (active) {
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!indexPayload?.sites?.length || !siteId) {
      return;
    }

    const siteLoaded = allPages.some((page) => page.siteId === siteId);
    if (siteLoaded) {
      return;
    }

    let active = true;
    fetch(`/api/resources/site/${encodeURIComponent(siteId)}`)
      .then((response) => response.json())
      .then((siteData) => {
        if (!active) return;
        setAllPages((current) => {
          const nextPages = normalizePages(siteData.pages || []);
          return [...current, ...nextPages];
        });
      })
      .catch((error) => {
        console.error("Failed to lazy load site", error);
      });

    return () => {
      active = false;
    };
  }, [siteId, indexPayload, allPages]);

  const allCategories = useMemo(() => collectCategories(allPages), [allPages]);
  const quickCategories = useMemo(() => pickQuickCategories(allCategories), [allCategories]);
  const filteredPages = useMemo(
    () => filterPages(allPages, { query, siteId, category, linkType }),
    [allPages, query, siteId, category, linkType]
  );
  const selectedPage = useMemo(
    () => allPages.find((page) => page.id === pageId),
    [allPages, pageId]
  );

  if (loading) {
    return (
      <main className="loading-shell">
        <h1>Loading campus resources...</h1>
      </main>
    );
  }

  return (
    <main className="wiki-shell">
      <header className="top-nav">
        <h1>Campus Resource Wiki</h1>
        <nav>
          {linkTo("/", navigate, pageType === "home" ? "nav-link nav-link--active" : "nav-link", "Home")}
          {linkTo("/resources", navigate, pageType !== "home" ? "nav-link nav-link--active" : "nav-link", "Resources")}
        </nav>
      </header>

      {pageType === "home" && (
        <section className="home-panel">
          <h2>Simple wiki for student essentials</h2>
          <p>
            Search once, then filter by department and category. This stays lightweight like a wiki,
            but provides student-first shortcuts and cleaner summaries.
          </p>
          <div className="stats-grid">
            <article>
              <strong>{indexPayload?.summary?.pageCount || 0}</strong>
              <span>Resources indexed</span>
            </article>
            <article>
              <strong>{indexPayload?.summary?.siteCount || 0}</strong>
              <span>Departments</span>
            </article>
            <article>
              <strong>{indexPayload?.summary?.linkCount || 0}</strong>
              <span>Outgoing links</span>
            </article>
          </div>
          <div className="chip-row">
            {quickCategories.map((quick) => (
              <button
                className="chip-button"
                key={quick.name}
                onClick={() => {
                  setCategory(quick.name);
                  navigate("/resources");
                }}
              >
                {quick.name} ({quick.count})
              </button>
            ))}
          </div>
        </section>
      )}

      {(pageType === "list" || pageType === "detail") && (
        <section className="content-layout">
          <aside className="filter-panel">
            <h2>Filter</h2>
            <label>
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="advising forms internship scholarship"
              />
            </label>
            <label>
              Department
              <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
                <option value="">All departments</option>
                {(indexPayload?.sites || []).map((site) => (
                  <option key={site.siteId} value={site.siteId}>
                    {site.label || normalizeSiteId(site.siteId)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {allCategories.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Link type
              <select value={linkType} onChange={(event) => setLinkType(event.target.value)}>
                <option value="">All links</option>
                <option value="pdf">Has PDF resources</option>
                <option value="web">Web links only</option>
              </select>
            </label>
          </aside>

          <div className="content-panel">
            {pageType === "list" && (
              <>
                <div className="content-panel__heading">
                  <h2>Resource index</h2>
                  <p>{filteredPages.length} results</p>
                </div>
                <div className="resource-grid">
                  {filteredPages.map((page) => (
                    <ResourceListCard key={page.id} page={page} onNavigate={navigate} />
                  ))}
                </div>
              </>
            )}

            {pageType === "detail" && selectedPage && (
              <article className="detail-page">
                <div className="content-panel__heading">
                  <h2>{selectedPage.title}</h2>
                  <button
                    className="ghost-button"
                    onClick={() => navigate("/resources")}
                  >
                    Back to results
                  </button>
                </div>
                <p>{selectedPage.description}</p>
                <div className="chip-row">
                  {selectedPage.categories?.map((item) => (
                    <span className="chip" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
                <h3>Key information</h3>
                <ul className="detail-list">
                  {selectedPage.contentBlocks.slice(0, 12).map((block) => (
                    <li key={block}>{block}</li>
                  ))}
                </ul>
                <h3>Useful links</h3>
                <ul className="detail-links">
                  {selectedPage.links.slice(0, 16).map((link) => (
                    <li key={`${link.url}-${link.text}`}>
                      <a href={link.url} target="_blank" rel="noreferrer">
                        {link.text}
                      </a>
                      <span>{link.type.toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
                <p className="source-row">
                  Source:{" "}
                  <a href={selectedPage.url} target="_blank" rel="noreferrer">
                    {selectedPage.sourceHost}
                  </a>
                </p>
              </article>
            )}

            {pageType === "detail" && !selectedPage && (
              <article className="detail-page">
                <h2>Resource not found</h2>
                <p>
                  This resource may belong to a site that has not loaded yet. Return to resources and
                  choose the relevant department.
                </p>
              </article>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
