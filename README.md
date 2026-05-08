# Scalable Products Backend

Intermediate system design project with:

- Nginx load balancer as the single entry point.
- Two identical Node.js API nodes.
- PostgreSQL primary/replica replication.
- Read/write splitting: writes go to the primary database, reads go to the replica.

## Architecture

```mermaid
flowchart LR
  Client["Client / curl / Postman"] --> LB["Nginx Load Balancer<br/>localhost:8080"]
  LB --> APIA["API Node A<br/>localhost:3001"]
  LB --> APIB["API Node B<br/>localhost:3002"]
  APIA -->|POST /products<br/>writes| Primary["PostgreSQL Primary<br/>localhost:5433"]
  APIB -->|POST /products<br/>writes| Primary
  APIA -->|GET /products<br/>reads| Replica["PostgreSQL Replica<br/>localhost:5434"]
  APIB -->|GET /products<br/>reads| Replica
  Primary -->|streaming replication| Replica
```

## Ports

| Component | Host Port | Container Port |
| --- | ---: | ---: |
| Nginx load balancer | 8080 | 80 |
| API Node A | 3001 | 3000 |
| API Node B | 3002 | 3000 |
| PostgreSQL Primary | 5433 | 5432 |
| PostgreSQL Replica | 5434 | 5432 |

## Phase 1: Database Replication Setup

The project uses Bitnami legacy PostgreSQL containers. The primary database is configured with:

```yaml
POSTGRESQL_REPLICATION_MODE: master
POSTGRESQL_REPLICATION_USER: repl_user
POSTGRESQL_REPLICATION_PASSWORD: repl_password
POSTGRESQL_USERNAME: app_user
POSTGRESQL_PASSWORD: app_password
POSTGRESQL_DATABASE: products_db
```

The replica database is configured with:

```yaml
POSTGRESQL_REPLICATION_MODE: slave
POSTGRESQL_MASTER_HOST: postgres-primary
POSTGRESQL_MASTER_PORT_NUMBER: 5432
POSTGRESQL_REPLICATION_USER: repl_user
POSTGRESQL_REPLICATION_PASSWORD: repl_password
POSTGRESQL_USERNAME: app_user
POSTGRESQL_PASSWORD: app_password
POSTGRESQL_DATABASE: products_db
```

Start the stack:

```powershell
docker compose up --build -d
```

Verify both database containers are healthy:

```powershell
docker compose ps
```

Verify replication manually by inserting into the primary and reading from the replica:

```powershell
docker compose exec postgres-primary psql -U app_user -d products_db -c "INSERT INTO products (name, price) VALUES ('Replication Test', 10.00);"
docker compose exec postgres-replica psql -U app_user -d products_db -c "SELECT id, name, price FROM products ORDER BY id DESC LIMIT 5;"
```

## Phase 2: API Development And Read/Write Splitting

The API uses two different database connection strings:

```yaml
WRITE_DATABASE_URL: postgres://app_user:app_password@postgres-primary:5432/products_db
READ_DATABASE_URL: postgres://app_user:app_password@postgres-replica:5432/products_db
```

Write operations use the primary pool:

```js
const writePool = new Pool({ connectionString: process.env.WRITE_DATABASE_URL });
```

Read operations use the replica pool:

```js
const readPool = new Pool({ connectionString: process.env.READ_DATABASE_URL });
```

API endpoints:

- `POST /products`: validates `name` and `price`, then inserts into the primary database.
- `GET /products`: reads products from the replica database and returns `processed_by` metadata.

Example POST:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/products" -ContentType "application/json" -Body '{"name":"Monitor","price":199.99}'
```

Example GET:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8080/products"
```

## Phase 3: Infrastructure And Load Balancing

Nginx receives traffic on `localhost:8080` and forwards requests to both API nodes:

```nginx
upstream products_api {
  server api-node-a:3000 max_fails=3 fail_timeout=10s;
  server api-node-b:3000 max_fails=3 fail_timeout=10s;
}
```

Nginx uses round-robin balancing by default. Passive failover is enabled with:

```nginx
proxy_next_upstream error timeout http_500 http_502 http_503 http_504;
```

Each API node exposes:

```text
GET /health
```

Docker Compose uses that endpoint for container health checks.

## Phase 4: Verification And Stress Test

Run the included script:

```powershell
.\scripts\demo-requests.ps1
```

Or run repeated GET requests manually:

```powershell
1..8 | ForEach-Object { Invoke-RestMethod -Method Get -Uri "http://localhost:8080/products" | Select-Object processed_by,database_role,count }
```

Expected result:

- `processed_by` alternates between `Node_A` and `Node_B`.
- `database_role` is `replica` for `GET /products`.
- Data created through `POST /products` appears in `GET /products`, proving primary-to-replica synchronization.

## Chaos Test

Stop one API node:

```powershell
docker compose stop api-node-a
```

Send requests through Nginx:

```powershell
1..6 | ForEach-Object { Invoke-RestMethod -Method Get -Uri "http://localhost:8080/products" | Select-Object processed_by,database_role,count }
```

Expected result:

- The system remains available.
- Responses come from `Node_B`.

Restart the stopped node:

```powershell
docker compose start api-node-a
```

## Cleanup

Stop containers:

```powershell
docker compose down
```

Remove database volumes if you want a clean database:

```powershell
docker compose down -v
```
## Link video
https://youtu.be/1cXBKQSfais?si=ir-yqEEVhPM3h98X