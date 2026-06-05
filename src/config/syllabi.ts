/**
 * Curated, interview-crucial syllabi for the teaching modes.
 *
 * Sourced from 2026 interview-prep research (DataCamp, DesignGurus, Hello
 * Interview, Kafka/Redis question banks). Used as the default ordered
 * curriculum so SQL and Backend modes walk a learner through the topics that
 * actually show up in interviews, building each concept on the last.
 */

export interface ModeSyllabus {
  source: string;
  description: string;
  syllabus: string[];
}

/** Problem-solving (DSA): the full pattern inventory — one problem per pattern. */
export const DSA_SYLLABUS: ModeSyllabus = {
  source: "2026 coding-interview pattern guides (NeetCode, Grokking, LeetCode)",
  description:
    "Every core DSA pattern, one problem each. Breadth across all patterns; the coach teaches the depth (variations, complexity, follow-ups) on each.",
  syllabus: [
    "Arrays & hashing (hash maps, frequency counting)",
    "Two pointers",
    "Sliding window",
    "Prefix sums",
    "Binary search (and on answer)",
    "Stacks (monotonic stack)",
    "Queues & deques",
    "Linked lists (fast/slow pointers, reversal)",
    "Trees: traversal & DFS/BFS",
    "Binary search trees",
    "Heaps / priority queues (top-K)",
    "Graphs: BFS/DFS, connected components",
    "Graphs: topological sort & shortest path",
    "Recursion",
    "Backtracking (subsets, permutations, combinations)",
    "Greedy",
    "Intervals (merge, sort by start)",
    "Bit manipulation",
    "Dynamic programming: 1D",
    "Dynamic programming: 2D / grids",
    "Tries (prefix trees)",
  ],
};

/** SQL: queries + design + concurrency/concepts. */
export const SQL_SYLLABUS: ModeSyllabus = {
  source: "2026 SQL interview guides (DataCamp, DataInterview, sql-practice)",
  description:
    "Crucial SQL interview topics in dependency order — from query basics to senior-level transactions, concurrency, and schema design.",
  syllabus: [
    "SELECT, WHERE, ORDER BY, LIMIT — query basics",
    "NULL handling: IS NULL, COALESCE, NULLIF, three-valued logic",
    "Aggregations: COUNT/SUM/AVG, GROUP BY, HAVING",
    "CASE expressions & conditional aggregation / pivoting",
    "Set operations: UNION/UNION ALL, INTERSECT, EXCEPT",
    "JOINs: INNER and LEFT (the 'with their X if any' pattern), self-joins",
    "Subqueries and CTEs (WITH), recursive CTEs",
    "Window functions: ROW_NUMBER, RANK, DENSE_RANK, PARTITION BY",
    "Running totals, moving averages, and top-N-per-group",
    "Deduplication and gap-and-island / sessionization patterns",
    "Indexing: B-tree indexes, composite indexes, covering indexes, when NOT to index",
    "Transactions and ACID properties",
    "Isolation levels and concurrency: dirty/non-repeatable/phantom reads, locking, deadlocks",
    "Query optimization: EXPLAIN/EXPLAIN ANALYZE, sargable predicates, N+1",
    "Schema design and normalization (1NF–3NF) vs denormalization trade-offs",
  ],
};

/** SQL interview PROBLEMS — the most-asked query problems (LeetCode SQL 50 /
 * GeeksforGeeks / FAANG question banks), each phrased against the fixed practice
 * schema (employees, departments, customers, products, orders) so the learner
 * actually writes + Runs the query. The coach poses the problem, teaches the
 * approach, and walks the solution. */
export const SQL_PROBLEMS: ModeSyllabus = {
  source: "2026 SQL interview question banks (LeetCode SQL 50, GeeksforGeeks, FAANG lists)",
  description:
    "8 high-yield SQL interview problems — one per core pattern, ordered easy→hard, all runnable against the practice database. Built for a 2-day cram: the coach poses each, teaches the pattern AND its common variants (so each problem covers a family), then has you write and Run the query.",
  syllabus: [
    "Nth highest salary: return the 2nd- (then Nth-) highest distinct employees.salary. Pattern: ranking via DENSE_RANK vs correlated subquery vs LIMIT/OFFSET, and NULL when none. (LeetCode 176/177)",
    "Employees earning more than their manager: self-join employees on manager_id. Pattern: self-joins and comparing a row to a related row. (LeetCode 181)",
    "Department top-N salaries: top-3 paid per department via DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC). Pattern: top-N-per-group + RANK vs DENSE_RANK vs ROW_NUMBER. (LeetCode 184/185)",
    "Customers who never ordered: anti-join — LEFT JOIN orders … WHERE orders.id IS NULL, or NOT EXISTS. Pattern: finding missing/unmatched rows. (LeetCode 183)",
    "Top-selling product by revenue: join orders↔products, GROUP BY, SUM(amount), ORDER BY … LIMIT. Pattern: aggregation + join + ordering; variant: revenue per customer/category with LEFT JOIN + COALESCE.",
    "Running total & month-over-month growth on orders: SUM() OVER (ORDER BY order_date) and LAG() for the prior period. Pattern: ordered window functions over time.",
    "Median salary (overall and per department): the classic 'no built-in MEDIAN'. Pattern: percentile/ordering tricks with window functions.",
    "Duplicate detection & dedup: GROUP BY key HAVING COUNT(*) > 1, then keep one per group with ROW_NUMBER. Pattern: dedup / gaps-and-islands intro.",
  ],
};

/** Backend + System Design: concepts taught through problems. */
export const BACKEND_SYLLABUS: ModeSyllabus = {
  source: "2026 backend/system-design guides (DesignGurus, Hello Interview, MeetAssist)",
  description:
    "Backend & system-design concepts taught through design problems — from caching and queues to scaling, concurrency, and class modeling.",
  syllabus: [
    "API design: REST/gRPC, idempotency, pagination, versioning",
    "Authentication & authorization: sessions, JWT, OAuth2",
    "Caching & Redis: cache-aside, write-through, TTL, eviction, invalidation, thundering herd",
    "CDNs & edge caching",
    "Consistent hashing",
    "Message queues & Kafka: pub/sub, partitions & ordering, consumer groups, idempotency, dead-letter queues",
    "Concurrency: threads, locks, mutexes, race conditions, deadlocks, optimistic vs pessimistic locking",
    "Memory leaks & resource management: leak sources, pooling, backpressure, GC pressure",
    "Load balancing: L4/L7, round-robin vs least-connections, health checks",
    "Database selection: SQL vs NoSQL, when to use each",
    "Sharding & partitioning: shard keys, hot partitions, rebalancing",
    "Replication & consistency: CAP, strong vs eventual, leader-follower, quorum",
    "Rate limiting: token bucket, leaky bucket, sliding window",
    "Object-oriented design: modeling classes, responsibilities, and relationships for a feature",
    "Recommendation systems at scale: candidate generation → ranking, offline vs online, large datasets/many users",
    "Observability: metrics, logging, distributed tracing, alerting",
  ],
};

export const MODE_SYLLABI: Record<"sql" | "sysdesign", ModeSyllabus> = {
  sql: SQL_SYLLABUS,
  sysdesign: BACKEND_SYLLABUS,
};
