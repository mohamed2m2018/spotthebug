/**
 * Starter Bug Database — Curated Real Bugs
 * 
 * Each bug is a short, focused code snippet (8-15 lines max)
 * with a known correct fix. The AI coach uses this data to
 * guide the training session.
 */

export interface Bug {
  id: string;
  framework: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  title: string;
  description: string;
  buggyCode: string;
  language: string;
  hint1: string;
  hint2: string;
  hint3: string;
  correctFix: string;
  explanation: string;
}

export const bugs: Bug[] = [
  {
    id: "react-001",
    framework: "react",
    category: "hooks",
    difficulty: "beginner",
    title: "Missing useEffect Cleanup",
    description: "A component subscribes to resize events but never unsubscribes.",
    buggyCode: `useEffect(() => {
  const onResize = () => setSize({
    w: window.innerWidth,
    h: window.innerHeight
  });
  window.addEventListener('resize', onResize);
}, []);`,
    language: "tsx",
    hint1: "What happens when this component unmounts?",
    hint2: "Is the event listener ever removed?",
    hint3: "Add a return function: return () => window.removeEventListener('resize', onResize)",
    correctFix: "Add cleanup: return () => window.removeEventListener('resize', onResize);",
    explanation: "Without cleanup, the listener stays active after unmount — a memory leak. Every remount adds a new listener without removing the old one."
  },
  {
    id: "react-002",
    framework: "react",
    category: "state",
    difficulty: "beginner",
    title: "Direct State Mutation",
    description: "A todo list that mutates state directly instead of creating a new array.",
    buggyCode: `const [todos, setTodos] = useState([]);

const addTodo = (text) => {
  todos.push(text);
  setTodos(todos);
};`,
    language: "tsx",
    hint1: "How is the todos array being modified?",
    hint2: "React checks if the reference changed. Does .push() create a new array?",
    hint3: "Use setTodos([...todos, text]) to create a new array reference.",
    correctFix: "Replace todos.push(text); setTodos(todos); with setTodos([...todos, text]);",
    explanation: "React uses reference equality. push() mutates the same array, so React thinks nothing changed and skips re-rendering."
  },
  {
    id: "react-003",
    framework: "react",
    category: "hooks",
    difficulty: "beginner",
    title: "Stale Closure in setInterval",
    description: "An auto-counter that stays stuck at 1 because of a stale closure.",
    buggyCode: `const [count, setCount] = useState(0);

useEffect(() => {
  const id = setInterval(() => {
    setCount(count + 1);
  }, 1000);
  return () => clearInterval(id);
}, []);`,
    language: "tsx",
    hint1: "Does the counter ever go past 1?",
    hint2: "The effect runs once — what value of count does the callback capture?",
    hint3: "Use the updater form: setCount(prev => prev + 1)",
    correctFix: "Replace setCount(count + 1) with setCount(prev => prev + 1).",
    explanation: "The closure captures count = 0 forever. Every tick sets 0+1=1. The functional updater always gets the latest state."
  },
  {
    id: "react-004",
    framework: "react",
    category: "performance",
    difficulty: "intermediate",
    title: "Infinite Re-render Loop",
    description: "A data-fetching useEffect that triggers itself on every render.",
    buggyCode: `const [user, setUser] = useState(null);

useEffect(() => {
  fetch(\`/api/users/\${userId}\`)
    .then(res => res.json())
    .then(data => setUser(data));
});`,
    language: "tsx",
    hint1: "What's missing at the end of useEffect?",
    hint2: "Without a dependency array, useEffect runs after EVERY render.",
    hint3: "Add [userId] as deps: useEffect(() => { ... }, [userId]);",
    correctFix: "Add the dependency array: useEffect(() => { ... }, [userId]);",
    explanation: "No deps = runs after every render. setUser triggers a re-render, which triggers useEffect again — infinite loop."
  },
  {
    id: "node-001",
    framework: "nodejs",
    category: "async",
    difficulty: "beginner",
    title: "Unhandled Promise Rejection",
    description: "An Express endpoint that reads a file without error handling.",
    buggyCode: `app.get('/config', async (req, res) => {
  const data = await fs.readFile('config.json', 'utf8');
  const config = JSON.parse(data);
  res.json(config);
});`,
    language: "javascript",
    hint1: "What if the file doesn't exist?",
    hint2: "There's no try/catch around the await.",
    hint3: "Wrap in try/catch and send a 500 error response.",
    correctFix: "Add try/catch: catch (err) { res.status(500).json({ error: 'Failed' }); }",
    explanation: "Without try/catch, a missing file crashes the route handler. The client gets no response and the server may crash."
  },
  {
    id: "python-001",
    framework: "python",
    category: "logic",
    difficulty: "beginner",
    title: "Mutable Default Argument",
    description: "A function where the default list is shared between all calls.",
    buggyCode: `def add_item(item, items=[]):
    items.append(item)
    return items

a = add_item("apple")   # ['apple']
b = add_item("banana")  # ['apple', 'banana'] ??`,
    language: "python",
    hint1: "Look at the default value for 'items'.",
    hint2: "In Python, default args are evaluated ONCE at definition time.",
    hint3: "Use None: def add_item(item, items=None): items = items or []",
    correctFix: "def add_item(item, items=None): if items is None: items = []",
    explanation: "The empty list is created once and shared across all calls. Use None as default and create a new list inside."
  },
  {
    id: "ts-001",
    framework: "typescript",
    category: "security",
    difficulty: "intermediate",
    title: "Unsafe Type Assertion",
    description: "A TypeScript API that trusts user input without runtime validation.",
    buggyCode: `app.post('/users', (req, res) => {
  const body = req.body as CreateUserRequest;
  db.users.create({
    name: body.name,
    email: body.email,
    role: body.role, // 'admin' from untrusted input!
  });
});`,
    language: "typescript",
    hint1: "How is req.body being validated?",
    hint2: "The 'as' keyword is compile-time only — no runtime check.",
    hint3: "Use Zod/Joi for runtime validation instead of type assertion.",
    correctFix: "Use runtime validation: const body = schema.parse(req.body);",
    explanation: "'as' tells TypeScript to trust you — but it doesn't validate at runtime. Anyone can send { role: 'admin' }."
  },
];

/**
 * Get bugs filtered by framework
 */
export function getBugsByFramework(framework: string, difficulty?: string): Bug[] {
  return bugs.filter(bug => {
    const matchFramework = bug.framework === framework.toLowerCase();
    const matchDifficulty = difficulty ? bug.difficulty === difficulty : true;
    return matchFramework && matchDifficulty;
  });
}

/**
 * Get a random bug matching the user's skills
 */
export function getRandomBug(
  skills: string[],
  excludeIds: string[] = [],
  difficulty?: string
): Bug | null {
  const matchingBugs = bugs.filter(bug => {
    const skillMatch = skills.some(skill => bug.framework === skill.toLowerCase());
    const notExcluded = !excludeIds.includes(bug.id);
    // Advanced users get all difficulties; others get their level only
    const difficultyMatch = !difficulty || difficulty === "advanced" || bug.difficulty === difficulty;
    return skillMatch && notExcluded && difficultyMatch;
  });
  
  if (matchingBugs.length === 0) return null;
  return matchingBugs[Math.floor(Math.random() * matchingBugs.length)];
}

/**
 * Get all available frameworks
 */
export function getAvailableFrameworks(): string[] {
  return [...new Set(bugs.map(bug => bug.framework))];
}
