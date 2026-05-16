Param(
  [string]$BackendBaseUrl = "http://localhost:3001",
  [string]$Question = "prueba de flujo"
)

Write-Host "== Health =="
Invoke-RestMethod -Method Get -Uri "$BackendBaseUrl/health" | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "== Auth Status =="
Invoke-RestMethod -Method Get -Uri "$BackendBaseUrl/auth/status" | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "== SSE Stream (12s max) =="
curl.exe -N --max-time 12 "$BackendBaseUrl/stream-answers?question=$([uri]::EscapeDataString($Question))"

