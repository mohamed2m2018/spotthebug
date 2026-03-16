import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.landing}>
      {/* ========== Header ========== */}
      <header className={styles.header}>
        <nav className={styles.nav}>
          <a href="/" className={styles.logo}>
            <span className={styles.logoIcon}>🐛</span>
            <span>Spot<span className={styles.logoHighlight}>TheBug</span></span>
          </a>
          <ul className={styles.navLinks}>
            <li><a href="#how-it-works">Three Modes</a></li>
            <li><a href="#tech-stack">Tech Stack</a></li>
          </ul>
          <a href="/login" className={`${styles.navCta} btn btn-primary`}>
            🎙️ Try It Live
          </a>
        </nav>
      </header>

      {/* ========== Hero ========== */}
      <section className={styles.hero}>
        <div className={`${styles.heroGlow} ${styles.heroGlowPrimary}`} />
        <div className={`${styles.heroGlow} ${styles.heroGlowAccent}`} />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Powered by Gemini Live API
          </div>

          <h1 className={styles.heroTitle}>
            Can You{" "}
            <span className="gradient-text">Spot The Bug</span>
            ?
          </h1>

          <p className={styles.heroSubtitle}>
            The voice-first AI platform that coaches developers through real-time
            conversations. See, hear, and speak — with native audio, live screen
            vision, and code execution.
          </p>

          <div className={styles.heroCtas}>
            <a href="/login" className="btn btn-primary">
              🎙️ Start Free Session
            </a>
            <a href="#how-it-works" className="btn btn-secondary">
              See How It Works →
            </a>
          </div>

          <div className={styles.heroStats}>
            <div className={styles.stat}>
              <div className={styles.statValue}>3 Modes</div>
              <div className={styles.statLabel}>Hunt · Pair · Solve</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>Real-Time</div>
              <div className={styles.statLabel}>Native Audio Voice</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>Live Vision</div>
              <div className={styles.statLabel}>Screen + Code Access</div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== Problem Section ========== */}
      <section className={styles.problem}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>The Problem</div>
          <h2 className={styles.sectionTitle}>
            AI Is Making Developers{" "}
            <span className="gradient-text">Lazy</span>
          </h2>
          <p className={styles.sectionSubtitle}>
            The data is clear — developers who rely on AI without critical thinking produce worse code.
          </p>
        </div>

        <div className={styles.problemGrid}>
          <div className={styles.problemCard}>
            <div className={styles.problemCardIcon}>📈</div>
            <div className={styles.problemCardStat}>41% More Bugs</div>
            <p className={styles.problemCardText}>
              Code written with AI assistants contains 41% more bugs than manually written code.
            </p>
          </div>
          <div className={styles.problemCard}>
            <div className={styles.problemCardIcon}>🧠</div>
            <div className={styles.problemCardStat}>Lower Scores</div>
            <p className={styles.problemCardText}>
              Developers using AI score significantly lower on debugging assessments.
            </p>
          </div>
          <div className={styles.problemCard}>
            <div className={styles.problemCardIcon}>💰</div>
            <div className={styles.problemCardStat}>Millions Lost</div>
            <p className={styles.problemCardText}>
              Companies mandating AI without oversight have lost millions in production failures.
            </p>
          </div>
          <div className={styles.problemCard}>
            <div className={styles.problemCardIcon}>📉</div>
            <div className={styles.problemCardStat}>Trust Falling</div>
            <p className={styles.problemCardText}>
              Developer confidence in AI code accuracy is decreasing despite increased usage.
            </p>
          </div>
        </div>
      </section>

      {/* ========== Three Modes ========== */}
      <section id="how-it-works" className={styles.howItWorks}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>Three Modes</div>
          <h2 className={styles.sectionTitle}>
            Choose How You{" "}
            <span className="gradient-text">Level Up</span>
          </h2>
          <p className={styles.sectionSubtitle}>
            Not a quiz. Not an interview. Real voice conversations with an AI mentor —
            powered by Gemini Live API.
          </p>
        </div>

        <div className={styles.modesGrid}>
          {/* Bug Hunt */}
          <div className={`${styles.modeCard} ${styles.modeCardHunt}`}>
            <div className={styles.modeCardIcon}>🔍</div>
            <h3 className={styles.modeCardTitle}>Bug Hunt</h3>
            <p className={styles.modeCardDesc}>
              Find real-world bugs in curated code. The AI voice coach guides you with progressive
              hints — never gives the answer.
            </p>
            <ul className={styles.modeCardFeatures}>
              <li>AI-generated bugs from real open-source patterns</li>
              <li>Voice conversation with interruption support</li>
              <li>Post-session AI evaluation via Google ADK</li>
              <li>Progressive difficulty across frameworks</li>
            </ul>
            <div className={styles.modeCardTech}>
              <span className={styles.techTag}>Gemini Live API</span>
              <span className={styles.techTag}>Google ADK</span>
            </div>
          </div>

          {/* Pair Programming */}
          <div className={`${styles.modeCard} ${styles.modeCardPair}`}>
            <div className={styles.modeCardPopular}>★ Most Advanced</div>
            <div className={styles.modeCardIcon}>🤝</div>
            <h3 className={styles.modeCardTitle}>Pair with AI</h3>
            <p className={styles.modeCardDesc}>
              Share your screen and get a real-time voice code review. The AI sees your code,
              reads your files, and teaches like a senior engineer.
            </p>
            <ul className={styles.modeCardFeatures}>
              <li>Live screen sharing with 1fps vision</li>
              <li>Reads workspace files via function calling</li>
              <li>Git diff analysis with pre-session code review</li>
              <li>Floating PiP desktop widget</li>
            </ul>
            <div className={styles.modeCardTech}>
              <span className={styles.techTag}>Screen Share</span>
              <span className={styles.techTag}>Function Calling</span>
              <span className={styles.techTag}>Google Search</span>
            </div>
          </div>

          {/* Problem Solve */}
          <div className={`${styles.modeCard} ${styles.modeCardSolve}`}>
            <div className={styles.modeCardIcon}>🧩</div>
            <h3 className={styles.modeCardTitle}>Problem Solve</h3>
            <p className={styles.modeCardDesc}>
              Tackle coding challenges with AI coaching. Write your solution, run tests in a
              real sandbox, and get voice guidance.
            </p>
            <ul className={styles.modeCardFeatures}>
              <li>Unique challenges grounded via Google Search</li>
              <li>Sandboxed code execution with real test cases</li>
              <li>Progressive hints and voice coaching</li>
              <li>Multi-language support (JS, Python, Go, Rust)</li>
            </ul>
            <div className={styles.modeCardTech}>
              <span className={styles.techTag}>Code Execution</span>
              <span className={styles.techTag}>Google Search</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========== Tech Stack ========== */}
      <section id="tech-stack" className={styles.pricing}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>Tech Stack</div>
          <h2 className={styles.sectionTitle}>
            Powered by{" "}
            <span className="gradient-text">Google AI</span>
          </h2>
          <p className={styles.sectionSubtitle}>
            Built on Google&apos;s most advanced multimodal AI platform — from real-time
            voice to cloud deployment.
          </p>
        </div>

        <div className={styles.techGrid}>
          <div className={styles.techCard}>
            <div className={styles.techCardIcon}>🎙️</div>
            <h3 className={styles.techCardTitle}>Gemini Live API</h3>
            <p className={styles.techCardDesc}>
              Real-time bidirectional voice with native audio generation.
              Interruptible conversations — not text-to-speech.
            </p>
            <div className={styles.techCardModel}>gemini-2.5-flash-native-audio</div>
          </div>

          <div className={styles.techCard}>
            <div className={styles.techCardIcon}>👁️</div>
            <h3 className={styles.techCardTitle}>Multimodal Vision</h3>
            <p className={styles.techCardDesc}>
              Live screen capture at 1fps sent as JPEG frames.
              The AI sees and understands your code in real-time.
            </p>
            <div className={styles.techCardModel}>Audio + Vision + Text</div>
          </div>

          <div className={styles.techCard}>
            <div className={styles.techCardIcon}>🤖</div>
            <h3 className={styles.techCardTitle}>Google ADK</h3>
            <p className={styles.techCardDesc}>
              Agent Development Kit evaluates session transcripts
              post-session for structured performance analysis.
            </p>
            <div className={styles.techCardModel}>Agent Development Kit</div>
          </div>

          <div className={styles.techCard}>
            <div className={styles.techCardIcon}>🔧</div>
            <h3 className={styles.techCardTitle}>Function Calling</h3>
            <p className={styles.techCardDesc}>
              AI reads workspace files via the readFile tool.
              Direct filesystem access during live voice sessions.
            </p>
            <div className={styles.techCardModel}>Tool Use (readFile)</div>
          </div>

          <div className={styles.techCard}>
            <div className={styles.techCardIcon}>🔍</div>
            <h3 className={styles.techCardTitle}>Google Search</h3>
            <p className={styles.techCardDesc}>
              Grounding tool ensures generated bugs and coding challenges
              are based on real-world patterns and documentation.
            </p>
            <div className={styles.techCardModel}>Search Grounding</div>
          </div>

          <div className={styles.techCard}>
            <div className={styles.techCardIcon}>☁️</div>
            <h3 className={styles.techCardTitle}>Google Cloud Run</h3>
            <p className={styles.techCardDesc}>
              Containerized Next.js deployment with multi-stage Docker build.
              Langfuse + OpenTelemetry for end-to-end tracing.
            </p>
            <div className={styles.techCardModel}>Cloud Run + OTel</div>
          </div>
        </div>
      </section>

      {/* ========== Footer ========== */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerCopy}>
            © {new Date().getFullYear()} SpotTheBug.ai — Train smarter, code better.
          </div>
          <ul className={styles.footerLinks}>
            <li><a href="#how-it-works">Three Modes</a></li>
            <li><a href="#tech-stack">Tech Stack</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
