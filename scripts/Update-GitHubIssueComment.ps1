param(
  [Parameter(Mandatory = $true)]
  [int64]$CommentId,

  [Parameter(Mandatory = $true)]
  [string]$BodyFilePath,

  [string]$Repo = "MIRR-LUKE/pararia"
)

. "$PSScriptRoot\\Enable-Utf8.ps1"

if (-not (Test-Path -LiteralPath $BodyFilePath)) {
  throw "Body file not found: $BodyFilePath"
}

$cred = @"
protocol=https
host=github.com
path=$Repo.git
"@ | git credential fill

$tokenLine = ($cred | Select-String '^password=').Line
if (-not $tokenLine) {
  throw "GitHub token not found via git credential fill."
}

$token = $tokenLine.Substring(9)
$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "User-Agent" = "codex-pararia-sync"
}

$body = Get-Content -LiteralPath $BodyFilePath -Raw -Encoding utf8
$payload = @{ body = $body } | ConvertTo-Json -Compress
$uri = "https://api.github.com/repos/$Repo/issues/comments/$CommentId"

Invoke-RestMethod `
  -Method Patch `
  -Uri $uri `
  -Headers $headers `
  -Body $payload `
  -ContentType "application/json; charset=utf-8"
