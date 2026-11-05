# Publishes a new version of PoE Upgrade Checker. Run it with release.bat.
#
#  1. Picks the version number. If the one in package.json is already out, it offers the next one.
#  2. Writes the changelog entry. "## Unreleased" in CHANGELOG.md becomes this version; if
#     there's none, the commit messages since the last release are used.
#  3. Commits, pushes to GitHub and tags the version.
#  4. GitHub Actions builds the installer and the portable .exe, runs the tests, and uploads
#     both to the release with the changelog as release notes.
#  5. Waits for the build and tells you when the download is live (or opens the log if it failed).
#
# Options: -Version 1.2.3 (use this version), -Yes (no questions), -NoWait (don't wait for the build),
#          -Beta (a test version like 0.5.0-beta.1: published as a GitHub pre-release, so installed copies
#          of the normal version don't update to it; the changelog's "Unreleased" stays as it is).
#          The next release.bat without -Beta offers the finished version (0.5.0).
# Works with the Windows PowerShell 5.1 that comes with Windows.

param(
  [string]$Version = '',
  [switch]$Yes,
  [switch]$NoWait,
  [switch]$Beta,
  [string]$Remote = 'https://github.com/ets-public/poe2-upgrade-checker.git',
  [string]$Repo = 'ets-public/poe2-upgrade-checker',
  [string]$ApiBase = 'https://api.github.com',
  [int]$PollSeconds = 30,
  [int]$TimeoutMinutes = 25
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may default to old TLS versions that GitHub refuses
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$utf8 = New-Object System.Text.UTF8Encoding $false

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Fail([string]$msg) { Say ''; Say $msg 'Red'; exit 1 }
function Run-Git {
  # runs git and returns its output lines. Throws if git fails, unless the first argument is -Soft.
  # (A simple function, so arguments like -c and --quiet pass straight through to git.)
  $gitArgs = @($args)
  $soft = $false
  if ($gitArgs.Count -and $gitArgs[0] -eq '-Soft') { $soft = $true; $gitArgs = @($gitArgs | Select-Object -Skip 1) }
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue' # git writes progress to stderr
  try { $out = @(& git @gitArgs 2>&1 | ForEach-Object { "$_" }); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $eap }
  $script:GitCode = $code
  if ($code -ne 0 -and -not $soft) { throw ("git " + ($gitArgs -join ' ') + " failed:`n" + ($out -join "`n")) }
  return $out
}
# git pull --rebase from GitHub. The README and its pictures are also edited on github.com sometimes:
# when only those clash, your copy wins (it's the newer one) instead of stopping the release.
function Pull-Rebase {
  $out = Run-Git -Soft @identity pull --rebase --quiet origin main
  $code = $script:GitCode
  $tries = 0
  while ($code -ne 0 -and $tries -lt 5) {
    $tries++
    $conf = @(Run-Git -Soft diff --name-only --diff-filter=U | Where-Object { $_ })
    if (-not $conf.Count -or @($conf | Where-Object { $_ -notmatch '^(README\.md|docs/.+)$' }).Count) { break }
    Say ('GitHub has its own edits of ' + ($conf -join ', ') + ' - keeping yours.') 'Yellow'
    foreach ($f in $conf) {
      Run-Git -Soft checkout --theirs -- $f | Out-Null
      if ($script:GitCode -eq 0) { Run-Git -Soft add -- $f | Out-Null } else { Run-Git -Soft rm -q -- $f | Out-Null } # you deleted it
    }
    $env:GIT_EDITOR = ':'
    $out = Run-Git -Soft @identity rebase --continue
    $code = $script:GitCode
  }
  $script:GitCode = $code # the caller checks this: other files clashing still stop the release
  return $out
}
function Read-Text([string]$p) { if (Test-Path $p) { return [IO.File]::ReadAllText((Resolve-Path $p), $utf8) } return '' }
function Write-Text([string]$p, [string]$t) { [IO.File]::WriteAllText((Join-Path $root $p), $t, $utf8) }
function Open-Url([string]$u) { try { Start-Process $u } catch { Say "Open: $u" } }
function Is-Version([string]$v) { if ($Beta) { return $v -match '^\d+\.\d+\.\d+-beta\.\d+$' } return $v -match '^\d+\.\d+\.\d+$' }
function Base-Of([string]$v) { return ($v -split '-')[0] }
function Next-Patch([string]$v) {
  if ($v -match '-') { return Base-Of $v } # after 0.5.0-beta.2 comes 0.5.0
  $p = $v.Split('.'); return "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
}
# the next beta: 0.5.0-beta.1 -> 0.5.0-beta.2; after a release 0.4.3 -> 0.5.0-beta.1 (a new minor version)
function Next-Beta([string]$v, [string[]]$tags) {
  if ($v -match '^(\d+\.\d+\.\d+)-beta\.(\d+)$') { $b = $Matches[1]; $n = [int]$Matches[2] + 1 }
  else { $p = $v.Split('.'); $b = "$($p[0]).$([int]$p[1] + 1).0"; $n = 1 }
  while ($tags -contains "v$b-beta.$n") { $n++ }
  return "$b-beta.$n"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "Git isn't installed. Get it from https://git-scm.com/download/win (the default options are fine), then run this again."
}

Say 'PoE Upgrade Checker - release' 'Yellow'
Say '------------------------------' 'Yellow'

# ---------- 1. the repository ----------
if (-not (Test-Path '.git')) { Run-Git init -b main | Out-Null }
$hasOrigin = @(Run-Git -Soft remote) -contains 'origin'
if (-not $hasOrigin) { Run-Git remote add origin $Remote | Out-Null }
# the workflow file lives in ci/ (so tools that can't write .github can still update it)
if (Test-Path 'ci\release.yml') {
  New-Item -ItemType Directory -Force -Path '.github\workflows' | Out-Null
  Copy-Item 'ci\release.yml' '.github\workflows\release.yml' -Force
}
$identity = @('-c', 'user.name=ets-public', '-c', 'user.email=ets-public@users.noreply.github.com')

$wip = $false
Say 'Checking GitHub for changes...'
Run-Git -Soft fetch origin --tags --quiet | Out-Null
Run-Git -Soft rev-parse --verify --quiet origin/main | Out-Null; $remoteMain = ($script:GitCode -eq 0)
Run-Git -Soft rev-parse --verify --quiet HEAD | Out-Null; $hasHead = ($script:GitCode -eq 0)
if ($remoteMain) {
  if ($hasHead) {
    # commit local edits first so the rebase is clean, then pick up anything changed on GitHub
    Run-Git add -A | Out-Null
    $pending = @(Run-Git status --porcelain)
    if ($pending.Count) { Run-Git @identity commit -q -m 'Work in progress' | Out-Null; $wip = $true } else { $wip = $false }
    $r = Pull-Rebase
    if ($script:GitCode -ne 0) {
      Run-Git -Soft rebase --abort | Out-Null
      if ($wip) { Run-Git -Soft reset --soft HEAD~1 | Out-Null }
      Fail ("Couldn't merge the changes made on GitHub with yours:`n" + ($r -join "`n") + "`nNothing was published.")
    }
    # keep it one release commit. If GitHub already had all of those changes (pushed from elsewhere),
    # the rebase dropped the empty "Work in progress" commit: then there's nothing to undo.
    if ($wip -and ((@(Run-Git log -1 --pretty=%s) -join '') -eq 'Work in progress')) { Run-Git reset --soft HEAD~1 | Out-Null }
  }
}

# ---------- nothing to release? ----------
$lastTag = (@(Run-Git -Soft tag --list 'v*') | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } | Sort-Object { [version]($_.Substring(1)) } | Select-Object -Last 1)
if ($lastTag -and $hasHead) {
  $changed = @(Run-Git -Soft diff --name-only $lastTag) + @(Run-Git -Soft ls-files --others --exclude-standard)
  $changed = @($changed | Where-Object { $_ -and $_ -notmatch '^(\.github/|CHANGELOG\.md$)' })
  if (-not $changed.Count) {
    Say ''
    Say "Nothing has changed since $lastTag." 'Yellow'
    if ($Yes) { exit 0 }
    $go = Read-Host 'Release anyway? (y/N)'
    if ($go -notmatch '^(y|yes)$') { exit 0 }
  } else {
    Say ("{0} file(s) changed since {1}." -f $changed.Count, $lastTag)
  }
}

# ---------- a newer Path of Building? ----------
# The app ships pinned Path of Building versions (tools\get-pob.js). A new league usually brings a
# new one: releasing without it means verdicts on the old passive tree and items.
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$pobOut = @(& node tools/check-pob.js 2>&1 | ForEach-Object { "$_" }); $pobCode = $LASTEXITCODE
$ErrorActionPreference = $eap
foreach ($l in $pobOut) { if ($l -match '^ *(NEWER|Update)') { Say $l 'Yellow' } else { Say $l } }
if ($pobCode -eq 2 -and -not $Yes) {
  $go = Read-Host 'A newer Path of Building is out. Release with the old one anyway? (y/N)'
  if ($go -notmatch '^(y|yes)$') { exit 0 }
}

# ---------- the GitHub release workflow ----------
# ci\release.yml is the editable copy of .github\workflows\release.yml (Claude can't write to
# .github\workflows). When they differ, the change is shown and copied over with your OK, so it's
# part of this release's commit and the build uses it.
$wfSrc = Join-Path $root 'ci\release.yml'; $wfDst = Join-Path $root '.github\workflows\release.yml'
if ((Test-Path $wfSrc) -and ((Read-Text 'ci\release.yml') -replace "`r", '') -ne ((Read-Text '.github\workflows\release.yml') -replace "`r", '')) {
  Say ''
  Say 'ci\release.yml has changes for the GitHub release workflow:' 'Yellow'
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & git --no-pager diff --no-index -- $wfDst $wfSrc 2>$null | ForEach-Object { Write-Host $_ }
  $ErrorActionPreference = $eap
  $go = if ($Yes) { 'y' } else { Read-Host 'Use them for this release? (Y/n)' }
  if ($go -match '^(n|no)$') { Fail 'Stopped: the workflow and ci\release.yml differ. Copy it yourself or undo the change in ci\release.yml, then run this again.' }
  New-Item -ItemType Directory -Force -Path (Split-Path $wfDst) | Out-Null
  Copy-Item $wfSrc $wfDst -Force
  Say 'Workflow updated from ci\release.yml.' 'Green'
}

# ---------- 2. version ----------
$pkgText = Read-Text 'package.json'
if ($pkgText -notmatch '"version"\s*:\s*"([^"]+)"') { Fail "Couldn't find the version in package.json." }
$current = $Matches[1]
$tags = @(Run-Git -Soft tag --list 'v*')
$released = $tags -contains "v$current"
$ver = $current
if ($Version) {
  if (-not (Is-Version $Version)) { if ($Beta) { Fail "'$Version' isn't a beta version like 0.5.0-beta.1." } Fail "'$Version' isn't a version like 1.2.3." }
  $ver = $Version
} elseif ($Beta) {
  $ver = Next-Beta $current $tags
  if (-not $Yes) {
    Say ''
    $answer = Read-Host "Release beta $($ver)? Press Enter for yes, or type another (e.g. 0.5.0-beta.1)"
    if ($answer) {
      if (-not (Is-Version $answer.Trim())) { Fail "'$answer' isn't a beta version like 0.5.0-beta.1." }
      $ver = $answer.Trim()
    }
  }
} elseif ($released -or $current -match '-') {
  $ver = Next-Patch $current
  if (-not $Yes) {
    Say ''
    if ($current -match '-') { Say "Version $current is a beta." } else { Say "Version $current is already released." }
    $answer = Read-Host "Release as $($ver)? Press Enter for yes, or type another version (e.g. 0.5.0)"
    if ($answer) {
      if (-not (Is-Version $answer.Trim())) { Fail "'$answer' isn't a version like 1.2.3." }
      $ver = $answer.Trim()
    }
  }
}
if ($tags -contains "v$ver") { Fail "Version $ver is already released. Pick a higher version." }
if ($ver -ne $current) {
  $pkgText = [regex]::new('("version"\s*:\s*")[^"]+(")').Replace($pkgText, ('${1}' + $ver + '${2}'), 1)
  Write-Text 'package.json' $pkgText
}
# package-lock.json carries the version too (at the top and for the root package, its first two
# "version" keys). Left behind, npm rewrites it on the next build and the folder shows a change.
$lockPath = Join-Path $root 'package-lock.json'
if (Test-Path $lockPath) {
  $lockText = Read-Text 'package-lock.json'
  $lockNew = [regex]::new('("version"\s*:\s*")[^"]+(")').Replace($lockText, ('${1}' + $ver + '${2}'), 2)
  if ($lockNew -ne $lockText) { Write-Text 'package-lock.json' $lockNew }
}
Say ''
if ($Beta) { Say "Releasing beta $ver (a pre-release: only people who install it get it)" 'Cyan' } else { Say "Releasing version $ver" 'Cyan' }

# ---------- 3. changelog ----------
# a beta leaves "## Unreleased" as it is: its release notes are taken from there, and the release
# that follows still gets the whole list
$today = (Get-Date).ToString('yyyy-MM-dd')
if (-not $Beta) {
$log = Read-Text 'CHANGELOG.md'
if (-not $log) { $log = "# Changelog`n`n" }
$heading = [regex]::Escape("## $ver")
if ($log -match '(?m)^## Unreleased[^\r\n]*') {
  $log = [regex]::new('(?m)^## Unreleased[^\r\n]*').Replace($log, "## $ver - $today", 1)
} elseif ($log -notmatch "(?m)^$heading(\s|$)") {
  $last = ($tags | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } | Sort-Object { [version]($_.Substring(1)) } | Select-Object -Last 1)
  $range = if ($last) { "$last..HEAD" } else { 'HEAD' }
  $lines = @()
  if ($hasHead) {
    $lines = @(Run-Git -Soft log --pretty=format:%s $range | Where-Object { $_ -and $_ -notmatch '^(Version|Release) \d' -and $_ -ne 'Work in progress' } | ForEach-Object { "- $_" })
  }
  if ($wip -or -not $lines.Count) { $lines += @('- Fixes and improvements.') }
  $entry = "## $ver - $today`n`n" + ($lines -join "`n") + "`n`n"
  if ($log -match '(?m)^# .*\r?\n') { $log = [regex]::new('(?m)^(# [^\r\n]*\r?\n\r?\n?)').Replace($log, ('${1}' + $entry), 1) } else { $log = $entry + $log }
}
Write-Text 'CHANGELOG.md' $log
}

# contributors: every pull request merged from GitHub since the last release gets a line in the
# changelog (thanks, with its number), unless the changelog already mentions it (tools\credits.js)
$lastFull = ($tags | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' -and $_ -ne "v$ver" } | Sort-Object { [version]($_.Substring(1)) } | Select-Object -Last 1)
$credArgs = @('tools/credits.js', '--heading', $(if ($Beta) { '## Unreleased' } else { "## $ver" }))
if ($lastFull) { $credArgs += @('--since', $lastFull) }
if ($Beta) { $credArgs += '--create' }
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$credOut = @(& node @credArgs 2>&1 | ForEach-Object { "$_" }); $credCode = $LASTEXITCODE
$ErrorActionPreference = $eap
foreach ($l in $credOut) { if ($credCode -eq 0) { Say $l 'Green' } else { Say $l 'Yellow' } }
if ($credCode -ne 0) { Say "Couldn't credit contributors in the changelog: check it before the release goes out." 'Yellow' }


# ---------- 4. commit, push, tag ----------
Run-Git add -A | Out-Null
if (@(Run-Git status --porcelain).Count) { Run-Git @identity commit -q -m "Release $ver" | Out-Null }
Run-Git branch -M main | Out-Null
Say 'Uploading to GitHub... (if a sign-in window opens, sign in as ets-public)'
$push = Run-Git -Soft push -u origin main
if ($script:GitCode -ne 0) {
  # someone changed GitHub in the meantime: merge once more and retry
  $r = Pull-Rebase
  if ($script:GitCode -ne 0) {
    Run-Git -Soft rebase --abort | Out-Null
    Fail ("Couldn't merge the changes made on GitHub with yours:`n" + ($r -join "`n") + "`nNothing was published.")
  }
  $push = Run-Git -Soft push -u origin main
  if ($script:GitCode -ne 0) { Fail ("Upload failed:`n" + ($push -join "`n")) }
}
Run-Git tag "v$ver" | Out-Null
$pt = Run-Git -Soft push origin "v$ver"
if ($script:GitCode -ne 0) { Run-Git -Soft tag -d "v$ver" | Out-Null; Fail ("Couldn't upload the version tag:`n" + ($pt -join "`n")) }
Say "Uploaded. GitHub is now building $ver." 'Green'

$actions = "https://github.com/$Repo/actions"
$releasePage = "https://github.com/$Repo/releases/tag/v$ver"
if ($NoWait) { Say "Follow the build here: $actions"; exit 0 }

# ---------- 5. wait for the build ----------
$headers = @{ 'User-Agent' = 'poe2-upgrade-checker-release'; 'Accept' = 'application/vnd.github+json' }
function Api([string]$path) { return Invoke-RestMethod -Uri ($ApiBase + $path) -Headers $headers -TimeoutSec 30 }
$start = Get-Date
$run = $null
Say "Waiting for the build (usually 4-8 minutes). Closing this window does not stop the build."
while ($true) {
  $elapsed = (Get-Date) - $start
  if ($elapsed.TotalMinutes -gt $TimeoutMinutes) { Say "Still building after $TimeoutMinutes minutes. Check $actions" 'Yellow'; Open-Url $actions; exit 0 }
  try {
    $runs = Api "/repos/$Repo/actions/runs?branch=v$ver&per_page=5"
    $run = @($runs.workflow_runs) | Where-Object { $_.head_branch -eq "v$ver" } | Select-Object -First 1
  } catch {
    $code = $null; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -eq 403 -or $code -eq 429) { Say "GitHub asked us to slow down; follow the build at $actions" 'Yellow'; Open-Url $actions; exit 0 }
    $run = $null
  }
  $status = if ($run) { $run.status } else { 'starting' }
  Write-Host ("`r  {0,-12} {1:mm\:ss}  " -f $status, $elapsed) -NoNewline
  if ($run -and $run.status -eq 'completed') { break }
  Start-Sleep -Seconds $PollSeconds
}
Write-Host ''
if ($run.conclusion -ne 'success') {
  Say "The build failed ($($run.conclusion)). Opening the log..." 'Red'
  Open-Url $run.html_url
  exit 1
}
# the release and its files
$rel = $null
for ($i = 0; $i -lt 6 -and -not $rel; $i++) {
  try { $rel = Api "/repos/$Repo/releases/tags/v$ver" } catch { Start-Sleep -Seconds 5 }
}
Say ''
if ($Beta) { Say "Beta $ver is live (as a pre-release). Send testers the link below; normal installs won't update to it." 'Green' } else { Say "Version $ver is live." 'Green' }
if ($rel) {
  foreach ($a in @($rel.assets) | Where-Object { $_.name -like '*.exe' }) {
    Say ("  {0}  ({1:N0} MB)" -f $a.name, ($a.size / 1MB))
    Say ("    {0}" -f $a.browser_download_url) 'DarkGray'
  }
}
if (-not $Beta) { Say 'Installed copies update themselves within a few hours (or now, from Options -> Updates).' }
Open-Url $releasePage
exit 0
