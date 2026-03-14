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
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#pricing">Pricing</a></li>
          </ul>
          <a href="/login" className={`${styles.navCta} btn btn-primary`}>
            Start Training — Free
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
            AI-Powered Voice Training
          </div>

          <h1 className={styles.heroTitle}>
            Can You{" "}
            <span className="gradient-text">Spot The Bug</span>
            ?
          </h1>

          <p className={styles.heroSubtitle}>
            Train your code review skills with an AI voice mentor.
            Real bugs from open source projects. Real voice conversations.
            Sharpen the #1 skill companies need.
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
              <div className={styles.statValue}>150K+</div>
              <div className={styles.statLabel}>Real Bug Reports</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>5 min</div>
              <div className={styles.statLabel}>Free Daily Session</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>Voice AI</div>
              <div className={styles.statLabel}>Real Conversations</div>
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

      {/* ========== How It Works ========== */}
      <section id="how-it-works" className={styles.howItWorks}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>How It Works</div>
          <h2 className={styles.sectionTitle}>
            A Voice Mentor That{" "}
            <span className="gradient-text">Coaches You</span>
          </h2>
          <p className={styles.sectionSubtitle}>
            Not a quiz. Not an interview. A supportive AI coach that helps you build real code review skills.
          </p>
        </div>

        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepIcon}>🎯</div>
            <h3 className={styles.stepTitle}>Tell Your Skills</h3>
            <p className={styles.stepDesc}>
              React? Node.js? Python? The AI picks bugs from your actual tech stack.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepIcon}>👀</div>
            <h3 className={styles.stepTitle}>Review Real Code</h3>
            <p className={styles.stepDesc}>
              Real bugs from real open source projects appear on screen. Take your time to understand.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>Discuss via Voice</h3>
            <div className={styles.stepIcon}>🎙️</div>
            <p className={styles.stepDesc}>
              Talk through what you see. The AI guides you with hints — never just gives the answer.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>4</div>
            <div className={styles.stepIcon}>🚀</div>
            <h3 className={styles.stepTitle}>Level Up</h3>
            <p className={styles.stepDesc}>
              Get a session summary, track your progress, and build real code review instincts.
            </p>
          </div>
        </div>
      </section>

      {/* ========== Pricing ========== */}
      <section id="pricing" className={styles.pricing}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>Pricing</div>
          <h2 className={styles.sectionTitle}>
            Start <span className="gradient-text">Free</span>, Level Up When Ready
          </h2>
          <p className={styles.sectionSubtitle}>
            Try it free. No credit card required. Upgrade when you see the value.
          </p>
        </div>

        <div className={styles.pricingGrid}>
          {/* Free Tier */}
          <div className={styles.pricingCard}>
            <div className={styles.pricingName}>Free</div>
            <div className={styles.pricingPrice}>$0</div>
            <div className={styles.pricingPeriod}>forever</div>
            <ul className={styles.pricingFeatures}>
              <li>1 session per day</li>
              <li>5 minutes per session</li>
              <li>3 code review rounds</li>
              <li>Basic feedback</li>
            </ul>
            <a href="/login" className={`${styles.pricingCta} btn btn-secondary`}>
              Get Started Free
            </a>
          </div>

          {/* Pro Tier */}
          <div className={`${styles.pricingCard} ${styles.pricingCardPopular}`}>
            <div className={styles.popularBadge}>Most Popular</div>
            <div className={styles.pricingName}>Pro</div>
            <div className={styles.pricingPrice}>$14.99</div>
            <div className={styles.pricingPeriod}>per month</div>
            <ul className={styles.pricingFeatures}>
              <li>20 sessions per month</li>
              <li>30 minutes per session</li>
              <li>All topics & frameworks</li>
              <li>Full progress tracking</li>
              <li>Session history & insights</li>
            </ul>
            <a href="/login" className={`${styles.pricingCta} btn btn-primary`}>
              Start Pro Trial
            </a>
          </div>

          {/* Team Tier */}
          <div className={styles.pricingCard}>
            <div className={styles.pricingName}>Team</div>
            <div className={styles.pricingPrice}>$11.99</div>
            <div className={styles.pricingPeriod}>per user / month</div>
            <ul className={styles.pricingFeatures}>
              <li>30 sessions per user / month</li>
              <li>Team skill dashboard</li>
              <li>Manager reports</li>
              <li>5-20 developers</li>
              <li>Priority support</li>
            </ul>
            <a href="/login" className={`${styles.pricingCta} btn btn-secondary`}>
              Contact Sales
            </a>
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
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#pricing">Pricing</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
