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

/** Per-problem detail for the DSA track, SAME ORDER as DSA_SYLLABUS.syllabus.
 * Shown in the problem panel (statement) and the editor (starter stub) so the
 * actual problem is visible where you write code — not only spoken by the coach. */
export interface ProblemDetail { name: string; statement: string; starter: string }
export const DSA_PROBLEM_DETAILS: ProblemDetail[] = [
  { name: "Two Sum",
    statement: "Given an integer array `nums` and an integer `target`, return the indices of the two numbers that add up to `target`. Exactly one solution; don't reuse an element.\n\nExample: nums = [2,7,11,15], target = 9 → [0,1] (because 2 + 7 = 9).",
    starter: "// Two Sum\nfunction twoSum(nums, target) {\n  // return [i, j] such that nums[i] + nums[j] === target\n}\n\nconsole.log(twoSum([2,7,11,15], 9)); // [0,1]\n" },
  { name: "Group Anagrams",
    statement: "Given an array of strings `strs`, group the anagrams together. Return a list of groups (order doesn't matter).\n\nExample: [\"eat\",\"tea\",\"tan\",\"ate\",\"nat\",\"bat\"] → [[\"eat\",\"tea\",\"ate\"],[\"tan\",\"nat\"],[\"bat\"]].",
    starter: "// Group Anagrams\nfunction groupAnagrams(strs) {\n  // group words that are anagrams of each other\n}\n\nconsole.log(groupAnagrams([\"eat\",\"tea\",\"tan\",\"ate\",\"nat\",\"bat\"]));\n" },
  { name: "Valid Palindrome",
    statement: "Given a string `s`, return true if it is a palindrome considering only alphanumeric characters and ignoring case.\n\nExample: \"A man, a plan, a canal: Panama\" → true. \"race a car\" → false.",
    starter: "// Valid Palindrome\nfunction isPalindrome(s) {\n  // ignore non-alphanumerics and case\n}\n\nconsole.log(isPalindrome(\"A man, a plan, a canal: Panama\")); // true\n" },
  { name: "Two Sum II (Sorted)",
    statement: "Given a 1-indexed SORTED array `numbers` and a `target`, return the 1-based indices [i, j] of the two numbers that add up to target. Use O(1) extra space.\n\nExample: numbers = [2,7,11,15], target = 9 → [1,2].",
    starter: "// Two Sum II - Input Array Is Sorted\nfunction twoSumSorted(numbers, target) {\n  // two pointers from both ends; return 1-based indices\n}\n\nconsole.log(twoSumSorted([2,7,11,15], 9)); // [1,2]\n" },
  { name: "Longest Substring Without Repeating Characters",
    statement: "Given a string `s`, return the length of the longest substring without repeating characters.\n\nExample: \"abcabcbb\" → 3 (\"abc\"). \"bbbbb\" → 1. \"pwwkew\" → 3 (\"wke\").",
    starter: "// Longest Substring Without Repeating Characters\nfunction lengthOfLongestSubstring(s) {\n  // sliding window + last-seen index\n}\n\nconsole.log(lengthOfLongestSubstring(\"abcabcbb\")); // 3\n" },
  { name: "Search in Rotated Sorted Array",
    statement: "A sorted array was rotated at an unknown pivot. Given `nums` and a `target`, return its index or -1, in O(log n).\n\nExample: nums = [4,5,6,7,0,1,2], target = 0 → 4.",
    starter: "// Search in Rotated Sorted Array\nfunction search(nums, target) {\n  // binary search; decide which half is sorted\n}\n\nconsole.log(search([4,5,6,7,0,1,2], 0)); // 4\n" },
  { name: "Find First and Last Position",
    statement: "Given a sorted array `nums` and a `target`, return [first, last] indices of target, or [-1,-1] if absent. O(log n).\n\nExample: nums = [5,7,7,8,8,10], target = 8 → [3,4].",
    starter: "// Find First and Last Position of Element in Sorted Array\nfunction searchRange(nums, target) {\n  // lower-bound and upper-bound binary search\n}\n\nconsole.log(searchRange([5,7,7,8,8,10], 8)); // [3,4]\n" },
  { name: "Merge Intervals",
    statement: "Given an array of `intervals` [start, end], merge all overlapping intervals.\n\nExample: [[1,3],[2,6],[8,10],[15,18]] → [[1,6],[8,10],[15,18]].",
    starter: "// Merge Intervals\nfunction merge(intervals) {\n  // sort by start, then sweep and merge overlaps\n}\n\nconsole.log(merge([[1,3],[2,6],[8,10],[15,18]]));\n" },
  { name: "Valid Parentheses",
    statement: "Given a string `s` of '()[]{}', return true if every bracket is correctly matched and nested.\n\nExample: \"()[]{}\" → true. \"(]\" → false. \"([)]\" → false.",
    starter: "// Valid Parentheses\nfunction isValid(s) {\n  // matching stack\n}\n\nconsole.log(isValid(\"()[]{}\")); // true\n" },
  { name: "Reverse Linked List",
    statement: "Reverse a singly linked list and return the new head. A node is { val, next }.\n\nExample: 1→2→3→4→5 → 5→4→3→2→1.",
    starter: "// Reverse Linked List\nfunction reverseList(head) {\n  // rewire prev/curr pointers\n}\n" },
  { name: "Invert Binary Tree",
    statement: "Given the root of a binary tree, invert it (swap every node's left and right child) and return the root. A node is { val, left, right }.",
    starter: "// Invert Binary Tree\nfunction invertTree(root) {\n  // recursive DFS: swap children\n}\n" },
  { name: "Maximum Depth of Binary Tree",
    statement: "Given the root of a binary tree, return its maximum depth (number of nodes along the longest root-to-leaf path).\n\nExample: [3,9,20,null,null,15,7] → 3.",
    starter: "// Maximum Depth of Binary Tree\nfunction maxDepth(root) {\n  // 1 + max(depth(left), depth(right))\n}\n" },
  { name: "Binary Tree Level Order Traversal",
    statement: "Given the root of a binary tree, return its node values level by level (top to bottom), as a list of lists.\n\nExample: [3,9,20,null,null,15,7] → [[3],[9,20],[15,7]].",
    starter: "// Binary Tree Level Order Traversal\nfunction levelOrder(root) {\n  // BFS with a queue, one level per round\n}\n" },
  { name: "Number of Islands",
    statement: "Given a 2D grid of '1' (land) and '0' (water), return the number of islands (4-directionally connected land).\n\nExample: grid with one connected blob of 1's → 1.",
    starter: "// Number of Islands\nfunction numIslands(grid) {\n  // DFS/BFS flood-fill each unvisited '1'\n}\n\nconsole.log(numIslands([[\"1\",\"1\",\"0\"],[\"1\",\"0\",\"0\"],[\"0\",\"0\",\"1\"]])); // 2\n" },
  { name: "Clone Graph",
    statement: "Given a reference to a node in a connected undirected graph (node = { val, neighbors }), return a deep copy of the graph.",
    starter: "// Clone Graph\nfunction cloneGraph(node) {\n  // DFS/BFS with a Map<original, clone>\n}\n" },
  { name: "Climbing Stairs",
    statement: "You climb a staircase of `n` steps, taking 1 or 2 steps at a time. Return how many distinct ways you can reach the top.\n\nExample: n = 3 → 3 ([1,1,1], [1,2], [2,1]).",
    starter: "// Climbing Stairs\nfunction climbStairs(n) {\n  // Fibonacci recurrence; memo or bottom-up\n}\n\nconsole.log(climbStairs(3)); // 3\n" },
  { name: "Coin Change",
    statement: "Given coin denominations `coins` and an `amount`, return the fewest coins to make the amount, or -1 if impossible.\n\nExample: coins = [1,2,5], amount = 11 → 3 (5+5+1).",
    starter: "// Coin Change\nfunction coinChange(coins, amount) {\n  // dp[a] = min coins to make amount a\n}\n\nconsole.log(coinChange([1,2,5], 11)); // 3\n" },
  { name: "Jump Game",
    statement: "Given an array `nums` where nums[i] is the max jump length from index i, return true if you can reach the last index.\n\nExample: [2,3,1,1,4] → true. [3,2,1,0,4] → false.",
    starter: "// Jump Game\nfunction canJump(nums) {\n  // greedy: track furthest reachable index\n}\n\nconsole.log(canJump([2,3,1,1,4])); // true\n" },
  { name: "Single Number",
    statement: "Given a non-empty array `nums` where every element appears twice except one, find the one. O(n) time, O(1) space.\n\nExample: [4,1,2,1,2] → 4.",
    starter: "// Single Number\nfunction singleNumber(nums) {\n  // XOR all elements\n}\n\nconsole.log(singleNumber([4,1,2,1,2])); // 4\n" },
  { name: "Merge Two Sorted Lists",
    statement: "Merge two sorted linked lists into one sorted list and return its head. A node is { val, next }.\n\nExample: 1→2→4 and 1→3→4 → 1→1→2→3→4→4.",
    starter: "// Merge Two Sorted Lists\nfunction mergeTwoLists(l1, l2) {\n  // merge with a dummy head\n}\n" },
];

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
    "The popular backend + system-design interview topics, taught through problems — core concepts first, then the classic 'design X' questions interviewers actually ask. Sourced from 2026 guides (DesignGurus, Hello Interview, ByteByteGo, IGotAnOffer).",
  syllabus: [
    // ── Core backend concepts ──
    "API design: REST vs gRPC vs GraphQL, idempotency, pagination (cursor vs offset), versioning, status codes",
    "Authentication & authorization: sessions vs JWT, OAuth2/OIDC, API keys, RBAC",
    "Caching & Redis: cache-aside, write-through, write-back, TTL, eviction (LRU/LFU), invalidation, thundering herd",
    "CDNs & edge caching: how/why, cache keys, purging",
    "Consistent hashing: ring, virtual nodes, why it beats modulo for sharding",
    "Message queues & Kafka: pub/sub, partitions & ordering, consumer groups, dead-letter queues, at-least-once vs exactly-once",
    "Idempotency & exactly-once processing: idempotency keys, dedup, retries safe-by-design",
    "Concurrency: threads, locks/mutexes, race conditions, deadlocks, optimistic vs pessimistic locking",
    "Distributed locks: Redis Redlock, leases, fencing tokens",
    "Memory leaks & resource management: leak sources, connection pooling, backpressure, GC pressure",
    "Load balancing: L4 vs L7, round-robin vs least-connections, health checks, sticky sessions",
    "Database selection: SQL vs NoSQL (KV, document, wide-column, graph), when to use each",
    "Indexing & query optimization: B-tree vs hash indexes, composite/covering indexes, EXPLAIN, N+1",
    "Transactions & isolation: ACID, isolation levels, dirty/non-repeatable/phantom reads, MVCC",
    "Sharding & partitioning: shard keys, hot partitions, rebalancing, cross-shard queries",
    "Replication & consistency: CAP, PACELC, strong vs eventual, leader-follower, quorum (R+W>N)",
    "Distributed transactions: 2-phase commit, Saga (orchestration vs choreography), outbox pattern",
    "Event-driven & CDC: event sourcing, change data capture, eventual consistency, conflict resolution",
    "Consensus & coordination: leader election, Raft/Paxos basics, ZooKeeper/etcd",
    "Resilience patterns: timeouts, retries with backoff+jitter, circuit breaker, bulkhead, graceful degradation",
    "Microservices vs monolith: service boundaries, API gateway, service discovery, sync vs async",
    "Rate limiting: token bucket, leaky bucket, sliding window — local vs distributed",
    "Unique ID generation at scale: UUID, Snowflake, ticket server",
    "Realtime delivery: WebSockets vs SSE vs long-polling, pub/sub fan-out, presence",
    "Search: inverted index, Elasticsearch basics, ranking, autocomplete/typeahead",
    "Blob/object storage & file uploads: S3-style storage, chunking, presigned URLs, CDN delivery",
    "Object-oriented design (LLD): modeling classes, responsibilities, relationships, SOLID",
    "Observability: metrics, logging, distributed tracing, alerting, SLO/SLA",
    // ── Classic 'design X' interview questions ──
    "Design a URL shortener (Bitly): hashing, collisions, redirect path, analytics, scale",
    "Design a rate limiter (the one they bolt onto everything)",
    "Design a news feed / Twitter timeline: fan-out on write vs read, ranking, the celebrity problem",
    "Design a chat system (WhatsApp/Messenger): WebSockets, delivery/read receipts, online status, storage",
    "Design a notification system: multi-channel (push/email/SMS), fan-out, dedup, retries",
    "Design a web crawler: frontier, politeness, dedup, distributed workers",
    "Design a distributed cache (like Redis/Memcached): partitioning, eviction, replication",
    "Design typeahead / autocomplete: trie, top-k, prefix sharding, caching",
    "Design a video platform (YouTube/Netflix): upload→transcode pipeline, CDN, metadata, recommendations",
    "Design ride-sharing (Uber/Lyft): geospatial indexing (geohash/quadtree), matching, surge",
    "Design a payment system (Stripe): idempotency, ledger/double-entry, consistency, reconciliation",
    "Design a key-value store (Dynamo-style): consistent hashing, quorum, vector clocks, hinted handoff",
  ],
};

export const MODE_SYLLABI: Record<"sql" | "sysdesign", ModeSyllabus> = {
  sql: SQL_SYLLABUS,
  sysdesign: BACKEND_SYLLABUS,
};
