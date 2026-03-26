param(
  [string]$Repo = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-RepoSlug {
  param([string]$ExplicitRepo)

  if ($ExplicitRepo) {
    return $ExplicitRepo
  }

  $remote = git remote get-url origin
  if (-not $remote) {
    throw "origin remote not found."
  }

  if ($remote -match 'github\.com[:/](.+?)(?:\.git)?$') {
    return $matches[1]
  }

  throw "Could not resolve GitHub repo slug: $remote"
}

function Get-IssueFiles {
  $issuesDir = Join-Path $PSScriptRoot "..\docs\issues"
  Get-ChildItem -Path $issuesDir -Filter "*.md" |
    Where-Object { $_.Name -ne "README.md" } |
    Sort-Object Name
}

function Parse-IssueFile {
  param([string]$Path)

  $content = Get-Content -Path $Path -Raw -Encoding UTF8
  $lines = $content -split "`r?`n"
  $title = $lines | Where-Object { $_ -match "^# " } | Select-Object -First 1
  if (-not $title) {
    throw "Issue title not found: $Path"
  }

  $labels = @()
  $labelHeaderIndex = [Array]::IndexOf($lines, "## Labels")
  if ($labelHeaderIndex -lt 0) {
    $labelHeaderIndex = [Array]::IndexOf($lines, "## ラベル")
  }
  if ($labelHeaderIndex -ge 0) {
    for ($i = $labelHeaderIndex + 1; $i -lt $lines.Length; $i++) {
      $line = $lines[$i].Trim()
      if (-not $line) { continue }
      if ($line -match "^## ") { break }
      if ($line.StartsWith('- `') -and $line.EndsWith('`')) {
        $labels += $line.Substring(3, $line.Length - 4)
      }
    }
  }

  [pscustomobject]@{
    Title  = $title.Substring(2).Trim()
    Labels = $labels
    Path   = $Path
  }
}

function Ensure-Label {
  param(
    [string]$RepoSlug,
    [string]$Name
  )

  $labelColors = @{
    "infra"            = "1d76db"
    "security"         = "b60205"
    "tech-debt"        = "6f42c1"
    "priority:high"    = "d93f0b"
    "backend"          = "0e8a16"
    "ai"               = "5319e7"
    "refactor"         = "fbca04"
    "quality"          = "0052cc"
    "tooling"          = "bfd4f2"
    "jobs"             = "c2e0c6"
    "architecture"     = "006b75"
    "priority:medium"  = "fbca04"
    "ops"              = "d4c5f9"
  }

  $descriptions = @{
    "infra"            = "Infrastructure related work"
    "security"         = "Security and privacy related work"
    "tech-debt"        = "Technical debt reduction"
    "priority:high"    = "High priority"
    "backend"          = "Backend application work"
    "ai"               = "AI or prompt pipeline work"
    "refactor"         = "Code structure refactor"
    "quality"          = "Quality assurance and evaluation"
    "tooling"          = "Developer tooling"
    "jobs"             = "Background jobs and workers"
    "architecture"     = "Architecture and system design"
    "priority:medium"  = "Medium priority"
    "ops"              = "Operations and admin workflow"
  }

  $existing = gh label list --repo $RepoSlug --limit 200 --json name --jq ".[].name" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to fetch labels. Check GitHub auth."
  }

  if ($existing -split "`r?`n" | Where-Object { $_ -eq $Name }) {
    return
  }

  $color = $labelColors[$Name]
  if (-not $color) {
    $color = "ededed"
  }
  $description = $descriptions[$Name]

  $args = @("label", "create", $Name, "--repo", $RepoSlug, "--color", $color)
  if ($description) {
    $args += @("--description", $description)
  }

  gh @args | Out-Null
}

function Find-ExistingIssueNumber {
  param(
    [string]$RepoSlug,
    [string]$Title
  )

  $raw = gh issue list --repo $RepoSlug --state all --search $Title --limit 20 --json number,title
  if (-not $raw) {
    return $null
  }

  $json = $raw | ConvertFrom-Json

  foreach ($item in $json) {
    if ($item.title -eq $Title) {
      return $item.number
    }
  }

  return $null
}

$repoSlug = Get-RepoSlug -ExplicitRepo $Repo
$issueFiles = Get-IssueFiles

Write-Host "Repo: $repoSlug"
Write-Host "Issues: $($issueFiles.Count)"

foreach ($file in $issueFiles) {
  $issue = Parse-IssueFile -Path $file.FullName
  $existingNumber = Find-ExistingIssueNumber -RepoSlug $repoSlug -Title $issue.Title

  if ($existingNumber) {
    Write-Host "Skip: #$existingNumber $($issue.Title)"
    continue
  }

  foreach ($label in $issue.Labels) {
    if (-not $DryRun) {
      Ensure-Label -RepoSlug $repoSlug -Name $label
    }
  }

  if ($DryRun) {
    Write-Host "DryRun: $($issue.Title)"
    continue
  }

  $args = @(
    "issue", "create",
    "--repo", $repoSlug,
    "--title", $issue.Title,
    "--body-file", $issue.Path
  )

  foreach ($label in $issue.Labels) {
    $args += @("--label", $label)
  }

  $createdUrl = gh @args
  Write-Host "Created: $createdUrl"
}
