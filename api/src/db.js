const { Pool } = require('pg');

const writePool = new Pool({
  connectionString: process.env.WRITE_DATABASE_URL,
  max: 10
});

const readPool = new Pool({
  connectionString: process.env.READ_DATABASE_URL,
  max: 10
});

async function migrate() {
  await writePool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function waitForReplicaSchema(maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await readPool.query(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'products'
      ) AS exists`
    );

    if (result.rows[0].exists) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Replica did not receive products table before startup timeout');
}

async function createProduct({ name, price }) {
  const result = await writePool.query(
    `INSERT INTO products (name, price)
     VALUES ($1, $2)
     RETURNING id, name, price::float, created_at`,
    [name, price]
  );

  return result.rows[0];
}

async function listProducts() {
  const result = await readPool.query(
    `SELECT id, name, price::float, created_at
     FROM products
     ORDER BY id ASC`
  );

  return result.rows;
}

async function closePools() {
  await Promise.all([writePool.end(), readPool.end()]);
}

module.exports = {
  migrate,
  waitForReplicaSchema,
  createProduct,
  listProducts,
  closePools
};
