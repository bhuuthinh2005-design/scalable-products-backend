const express = require('express');
const { migrate, waitForReplicaSchema, createProduct, listProducts, closePools } = require('./db');

const app = express();
const nodeId = process.env.NODE_ID || 'Node_Unknown';
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    processed_by: nodeId
  });
});

app.post('/products', async (req, res, next) => {
  try {
    const { name, price } = req.body;
    const numericPrice = Number(price);

    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }

    const product = await createProduct({
      name: name.trim(),
      price: numericPrice
    });

    res.status(201).json({
      message: 'Product created on master database',
      data: product,
      processed_by: nodeId,
      database_role: 'master'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/products', async (_req, res, next) => {
  try {
    const products = await listProducts();

    res.json({
      data: products,
      count: products.length,
      processed_by: nodeId,
      database_role: 'replica'
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(`[${nodeId}]`, error);
  res.status(500).json({
    error: 'Internal server error',
    processed_by: nodeId
  });
});

async function start() {
  await migrate();
  await waitForReplicaSchema();
  app.listen(port, () => {
    console.log(`${nodeId} listening on port ${port}`);
  });
}

process.on('SIGTERM', async () => {
  await closePools();
  process.exit(0);
});

start().catch((error) => {
  console.error(`[${nodeId}] failed to start`, error);
  process.exit(1);
});
