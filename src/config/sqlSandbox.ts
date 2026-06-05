/**
 * Fixed practice database for SQL mode. The Run button executes the learner's
 * query against this in-memory SQLite schema, and the coach teaches against the
 * same tables (the schema description is injected into the session context).
 *
 * Kept small but rich enough for joins, aggregations, window functions,
 * subqueries/CTEs, and date logic.
 */

export const SQL_SEED = `
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  manager_id INTEGER REFERENCES employees(id),
  salary INTEGER NOT NULL,
  hire_date TEXT NOT NULL
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL,
  order_date TEXT NOT NULL,
  amount REAL NOT NULL
);

INSERT INTO departments (id, name) VALUES
  (1, 'Engineering'), (2, 'Sales'), (3, 'Marketing'), (4, 'HR');

INSERT INTO employees (id, name, department_id, manager_id, salary, hire_date) VALUES
  (1, 'Alice',   1, NULL, 145000, '2019-03-01'),
  (2, 'Bob',     1, 1,    120000, '2020-06-15'),
  (3, 'Carol',   1, 1,    118000, '2021-01-20'),
  (4, 'Dan',     2, NULL, 130000, '2018-11-05'),
  (5, 'Eve',     2, 4,     95000, '2022-02-10'),
  (6, 'Frank',   2, 4,     98000, '2021-09-30'),
  (7, 'Grace',   3, NULL, 110000, '2020-07-22'),
  (8, 'Heidi',   3, 7,     85000, '2023-04-01'),
  (9, 'Ivan',    4, NULL,  90000, '2019-12-12');

INSERT INTO customers (id, name, country) VALUES
  (1, 'Acme Corp',     'USA'),
  (2, 'Globex',        'USA'),
  (3, 'Initech',       'Canada'),
  (4, 'Umbrella',      'UK'),
  (5, 'Soylent',       'Germany');

INSERT INTO products (id, name, category, price) VALUES
  (1, 'Widget',   'Hardware', 25.00),
  (2, 'Gadget',   'Hardware', 40.00),
  (3, 'Licence',  'Software', 199.00),
  (4, 'Support',  'Service',  500.00),
  (5, 'Cable',    'Hardware',  9.50);

INSERT INTO orders (id, customer_id, product_id, quantity, order_date, amount) VALUES
  (1, 1, 1, 10, '2023-01-05', 250.00),
  (2, 1, 3,  1, '2023-01-20', 199.00),
  (3, 2, 2,  5, '2023-02-11', 200.00),
  (4, 3, 4,  1, '2023-02-15', 500.00),
  (5, 2, 1, 20, '2023-03-02', 500.00),
  (6, 4, 5, 50, '2023-03-18', 475.00),
  (7, 5, 3,  2, '2023-04-01', 398.00),
  (8, 1, 2,  3, '2023-04-12', 120.00),
  (9, 3, 1,  8, '2023-05-09', 200.00),
  (10, 2, 4, 1, '2023-05-21', 500.00);
`;

/** Compact schema for the session INTRO — kept small so the opening turn stays
 * under the size that makes the model reply text-only (no audio). */
export const SQL_SCHEMA_COMPACT = "Practice tables: departments(id, name); employees(id, name, department_id, manager_id→employees.id, salary, hire_date); customers(id, name, country); products(id, name, category, price); orders(id, customer_id, product_id, quantity, order_date, amount).";

/** Human-readable schema, injected into the SQL session context for the coach. */
export const SQL_SCHEMA_DESCRIPTION = `Practice database (SQLite). Available tables:
- departments(id, name)
- employees(id, name, department_id, manager_id, salary, hire_date)  -- manager_id is a self-reference to employees.id
- customers(id, name, country)
- products(id, name, category, price)
- orders(id, customer_id, product_id, quantity, order_date, amount)

The developer runs queries against this exact dataset. Teach using these tables, and pose problems that fit them (joins, aggregations, window functions, self-joins on employees.manager_id, date logic on hire_date/order_date).`;
