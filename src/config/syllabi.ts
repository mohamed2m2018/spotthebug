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
  source: "2-day NeetCode-style cram — 20 must-know LeetCode problems (one per core pattern)",
  description:
    "20 must-know LeetCode problems for a 2-day cram (Day 1: arrays → linked lists; Day 2: trees → DP). Each item is a CONCRETE problem: the coach poses the actual problem, has you write the solution in the editor, then teaches the underlying pattern, complexity, and follow-ups.",
  syllabus: [
    // ── Day 1: core patterns ──
    "Two Sum (Arrays & Hashing) — given an integer array nums and a target, return the indices of the two numbers that add up to target. Pattern: hash-map complement lookup for O(n).",
    "Group Anagrams (Arrays & Hashing) — group a list of strings so that anagrams are together. Pattern: hashing by sorted string or character-count key.",
    "Valid Palindrome (Two Pointers) — return whether a string is a palindrome considering only alphanumeric characters and ignoring case. Pattern: two pointers converging from both ends.",
    "Two Sum II – Input Array Is Sorted (Two Pointers) — sorted array; return the 1-indexed pair of numbers that add to target. Pattern: converging two pointers (contrast with hashing).",
    "Longest Substring Without Repeating Characters (Sliding Window) — length of the longest substring with all unique characters. Pattern: variable-size sliding window + last-seen map.",
    "Search in Rotated Sorted Array (Binary Search) — find a target's index in a rotated sorted array in O(log n). Pattern: binary search deciding which half is sorted.",
    "Find First and Last Position of Element in Sorted Array (Binary Search) — return the first and last index of target. Pattern: lower-bound / upper-bound binary search.",
    "Merge Intervals (Sorting / Intervals) — merge all overlapping intervals. Pattern: sort by start, then sweep and merge.",
    "Valid Parentheses (Stack) — return whether a string of brackets is correctly matched and nested. Pattern: matching stack.",
    "Reverse Linked List (Linked List) — reverse a singly linked list. Pattern: iterative prev/curr pointer rewiring (and the recursive variant).",
    // ── Day 2: advanced patterns ──
    "Invert Binary Tree (Trees / DFS) — swap every node's left and right child. Pattern: recursive DFS.",
    "Maximum Depth of Binary Tree (Trees / DFS) — return the maximum depth. Pattern: DFS height recursion.",
    "Binary Tree Level Order Traversal (Trees / BFS) — return node values level by level. Pattern: BFS with a queue.",
    "Number of Islands (Graphs) — count connected regions of '1's in a grid. Pattern: grid DFS/BFS flood fill.",
    "Clone Graph (Graphs) — deep-copy a connected undirected graph. Pattern: DFS/BFS with a visited→clone map.",
    "Climbing Stairs (Dynamic Programming) — number of distinct ways to climb n stairs taking 1 or 2 steps. Pattern: Fibonacci recurrence + memo / bottom-up.",
    "Coin Change (Dynamic Programming) — fewest coins to make an amount, or -1 if impossible. Pattern: unbounded-knapsack DP.",
    "Jump Game (Greedy) — given max jump lengths, can you reach the last index? Pattern: furthest-reachable greedy.",
    "Single Number (Bit Manipulation) — every element appears twice except one; find it. Pattern: XOR cancellation.",
    "Merge Two Sorted Lists (Linked List) — merge two sorted linked lists into one sorted list. Pattern: merge with a dummy head.",
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
    "10 high-yield SQL interview problems — one per core pattern, ordered easy→hard, all runnable against the practice database. Built for a 2-day cram: the coach poses each, teaches the pattern AND its common variants (so each problem covers a family), then has you write and Run the query.",
  syllabus: [
    "Nth highest salary: return the 2nd- (then Nth-) highest distinct employees.salary. Pattern: ranking via DENSE_RANK vs correlated subquery vs LIMIT/OFFSET, and NULL when none. (LeetCode 176/177)",
    "Employees earning more than their manager: self-join employees on manager_id. Pattern: self-joins and comparing a row to a related row. (LeetCode 181)",
    "Department top-N salaries: top-3 paid per department via DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC). Pattern: top-N-per-group + RANK vs DENSE_RANK vs ROW_NUMBER. (LeetCode 184/185)",
    "Customers who never ordered: anti-join — LEFT JOIN orders … WHERE orders.id IS NULL, or NOT EXISTS. Pattern: finding missing/unmatched rows. (LeetCode 183)",
    "Top-selling product by revenue: join orders↔products, GROUP BY, SUM(amount), ORDER BY … LIMIT. Pattern: aggregation + join + ordering; variant: revenue per customer/category with LEFT JOIN + COALESCE.",
    "Conditional aggregation / pivot: one row per product category with revenue split into columns by customer country — SUM(CASE WHEN customers.country = 'USA' THEN orders.amount END) etc. Pattern: turning rows into columns; also % of total via a window SUM.",
    "Running total & month-over-month growth on orders: SUM() OVER (ORDER BY order_date) and LAG() for the prior period. Pattern: ordered window functions over time.",
    "Consecutive sequences & gaps (gaps-and-islands): find gaps in the orders.id sequence (ids with no successor), and runs of consecutive ids, using the ROW_NUMBER() − id trick. Pattern: streak/consecutive detection (e.g. N consecutive logins, longest streak).",
    "Median salary (overall and per department): the classic 'no built-in MEDIAN'. Pattern: percentile/ordering tricks with window functions.",
    "Duplicate detection & dedup: GROUP BY key HAVING COUNT(*) > 1, then keep one per group with ROW_NUMBER. Pattern: dedup.",
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
