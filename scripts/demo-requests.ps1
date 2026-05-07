$ErrorActionPreference = "Stop"

$baseUrl = "http://localhost:8080"

Write-Host "Creating products through the Nginx entry point..."
Invoke-RestMethod -Method Post -Uri "$baseUrl/products" -ContentType "application/json" -Body '{"name":"Keyboard","price":79.99}'
Invoke-RestMethod -Method Post -Uri "$baseUrl/products" -ContentType "application/json" -Body '{"name":"Mouse","price":24.50}'

Write-Host "`nReading repeatedly to show round-robin API nodes and replica reads..."
1..8 | ForEach-Object {
  $response = Invoke-RestMethod -Method Get -Uri "$baseUrl/products"
  [PSCustomObject]@{
    Request = $_
    ProcessedBy = $response.processed_by
    DatabaseRole = $response.database_role
    Count = $response.count
  }
}
