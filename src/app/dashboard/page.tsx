"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import styles from "./dashboard.module.css";

interface UserStats {
  totalSessions: number;
  bugsFound: number;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Fetch real stats from Prisma DB
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/user-stats")
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch((err) => console.error("[Dashboard] Failed to load stats:", err));
  }, [status]);

  if (status === "loading") {
    return (
      <div className={styles.dashboardPage}>
        <div className={styles.dashboardContent}>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)", marginTop: "4rem" }}>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className={styles.dashboardPage}>
      {/* Header */}
      <header className={styles.dashboardHeader}>
        <nav className={styles.dashboardNav}>
          <a href="/" className={styles.dashboardLogo}>
            <span>🐛</span>
            <span>Spot<span className={styles.dashboardLogoHighlight}>TheBug</span></span>
          </a>

          <div className={styles.dashboardNavRight}>
            <div className={styles.userInfo}>
              {session.user?.image && (
                <Image
                  src={session.user.image}
                  alt="Avatar"
                  width={32}
                  height={32}
                  className={styles.userAvatar}
                />
              )}
              <span>{session.user?.name || session.user?.email}</span>
            </div>
            <button
              className={styles.signOutBtn}
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Sign Out
            </button>
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className={styles.dashboardContent}>
        <div className={styles.welcomeSection}>
          <h1 className={styles.welcomeTitle}>
            Welcome back, {session.user?.name?.split(" ")[0] || "Developer"} 👋
          </h1>
          <p className={styles.welcomeSubtitle}>
            Ready to sharpen your code review skills?
          </p>
        </div>

        {/* Start Session CTA */}
        <div className={styles.startSessionCard}>
          <div className={styles.startSessionGlow} />
          <h2 className={styles.startSessionTitle}>🎙️ Start Training Session</h2>
          <p className={styles.startSessionDesc}>
            Practice finding real bugs with your AI voice mentor
          </p>
          <a href="/session" className={`${styles.startSessionBtn} btn btn-primary`}>
            Start Session
          </a>
        </div>

        {/* Stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statCardLabel}>Total Sessions</div>
            <div className={styles.statCardValue}>
              {stats ? stats.totalSessions : "—"}
            </div>
            <div className={styles.statCardSub}>
              {stats && stats.totalSessions > 0
                ? `Across all modes`
                : "Start your first one!"}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardLabel}>Bugs Found</div>
            <div className={styles.statCardValue}>
              {stats ? stats.bugsFound : "—"}
            </div>
            <div className={styles.statCardSub}>
              {stats && stats.bugsFound > 0
                ? "Across all sessions"
                : "Hunt mode tracks your finds"}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
