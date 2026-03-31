import { useEffect, useState } from "react";

const quickLinkIcons = {
  advising: "A",
  handshake: "H",
  events: "E",
  career: "C",
  scholarships: "S"
};

function ResourceCard({ item }) {
  return (
    <article className="resource-card">
      <div className="resource-card__top">
        <span className="resource-card__badge">{item.category}</span>
        <span className="resource-card__icon">
          {quickLinkIcons[item.iconKey] || "R"}
        </span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <a href={item.href}>{item.cta}</a>
    </article>
  );
}

function MajorPanel({ major, title }) {
  return (
    <article className="major-panel">
      <div className="major-panel__header">
        <div>
          <p className="eyebrow">Selected major</p>
          <h3>{major.name}</h3>
        </div>
        <span>{title}</span>
      </div>
      <p className="major-panel__summary">{major.summary}</p>
      <div className="major-panel__grid">
        {major.resources.map((resource) => (
          <div className="major-detail" key={resource.title}>
            <h4>{resource.title}</h4>
            <p>{resource.description}</p>
            <a href={resource.href}>{resource.cta}</a>
          </div>
        ))}
      </div>
    </article>
  );
}

function App() {
  const [homepageData, setHomepageData] = useState(null);
  const [selectedMajor, setSelectedMajor] = useState("Computer Science");

  useEffect(() => {
    let isMounted = true;

    async function loadHomepageData() {
      const response = await fetch("/api/homepage-data");
      const data = await response.json();

      if (isMounted) {
        setHomepageData(data);
        setSelectedMajor(data.majors[0]?.name ?? "Computer Science");
      }
    }

    loadHomepageData().catch((error) => {
      console.error("Unable to load homepage data", error);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const activeMajor = homepageData?.majors?.find(
    (major) => major.name === selectedMajor
  );

  if (!homepageData || !activeMajor) {
    return (
      <main className="loading-shell">
        <div className="loading-shell__panel">
          <p className="eyebrow">Campus Resource Hub</p>
          <h1>Building your shortcut to campus support...</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero__content">
          <p className="eyebrow">Student-first campus navigation</p>
          <h1>Find the right university resource without digging through a maze of old webpages.</h1>
          <p className="hero__copy">
            One home base for advising, scholarships, career support, campus forms,
            student clubs, and major-specific opportunities.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#major-resources">
              Explore by major
            </a>
            <a className="button button--secondary" href="#general-resources">
              Browse general resources
            </a>
          </div>
          <div className="hero__stats">
            {homepageData.stats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hero__panel">
          <div className="hero__panel-card">
            <p className="eyebrow">Today's student workflow</p>
            <h2>Start with your goal, not the department org chart.</h2>
            <ul>
              {homepageData.studentGoals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Quick wins</p>
            <h2>Jump straight to the resources students need most.</h2>
          </div>
        </div>
        <div className="resource-grid resource-grid--five">
          {homepageData.quickLinks.map((item) => (
            <ResourceCard item={item} key={item.title} />
          ))}
        </div>
      </section>

      <section className="section" id="major-resources">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">By major</p>
            <h2>Personalize the hub for a student's academic path.</h2>
          </div>
          <label className="select-wrap" htmlFor="major-select">
            <span>Choose a major</span>
            <select
              id="major-select"
              value={selectedMajor}
              onChange={(event) => setSelectedMajor(event.target.value)}
            >
              {homepageData.majors.map((major) => (
                <option key={major.name} value={major.name}>
                  {major.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <MajorPanel major={activeMajor} title={activeMajor.college} />
      </section>

      <section className="section" id="general-resources">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Campus essentials</p>
            <h2>Keep general student resources easy to scan and even easier to reach.</h2>
          </div>
        </div>
        <div className="general-layout">
          <div className="resource-grid">
            {homepageData.generalResources.map((item) => (
              <ResourceCard item={item} key={item.title} />
            ))}
          </div>
          <aside className="info-rail">
            <div className="info-rail__card">
              <p className="eyebrow">Designed for clarity</p>
              <h3>What this homepage is doing differently</h3>
              <ul>
                {homepageData.principles.map((principle) => (
                  <li key={principle}>{principle}</li>
                ))}
              </ul>
            </div>
            <div className="info-rail__card info-rail__card--accent">
              <p className="eyebrow">Next build step</p>
              <h3>Add search, authentication, and live campus data.</h3>
              <p>
                This homepage is ready to grow into a fuller student dashboard
                with saved links, announcements, and tailored recommendations.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default App;
