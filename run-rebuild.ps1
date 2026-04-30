$ErrorActionPreference = "Stop"

$phases = @(
    @{ Name = "Phase 1 - Foundation";                      File = "phases\REBUILD_PHASE_1_FOUNDATION.md" }
    @{ Name = "Phase 2 - Metadata Extraction";             File = "phases\REBUILD_PHASE_2_METADATA.md" }
    @{ Name = "Phase 3 - Organization Engine";             File = "phases\REBUILD_PHASE_3_ORGANIZE.md" }
    @{ Name = "Phase 4 - Dupes, Multi-Source, Sort";       File = "phases\REBUILD_PHASE_4_DUPES_MULTI_SORT.md" }
    @{ Name = "Phase 5 - UI Polish + Monetization";        File = "phases\REBUILD_PHASE_5_POLISH_MONETIZE.md" }
    @{ Name = "Phase 6 - Testing + Stress Tests";          File = "phases\REBUILD_PHASE_6_TESTING.md" }
)

Write-Host ""
Write-Host "========================================"
Write-Host "  PixelPusher - FULL REBUILD"
Write-Host "  6 phases. Everything from scratch."
Write-Host "  Every bug fix baked in from day one."
Write-Host "========================================"
Write-Host ""

try {
    $null = Get-Command claude -ErrorAction Stop
} catch {
    Write-Host "ERROR: claude command not found."
    exit 1
}

foreach ($phase in $phases) {
    if (-not (Test-Path $phase.File)) {
        Write-Host "ERROR: Missing file: $($phase.File)"
        exit 1
    }
}

Write-Host "All 6 phase files found."
Write-Host "Estimated time: 3-6 hours."
Write-Host "Starting in 5 seconds..."
Start-Sleep -Seconds 5

$totalPhases = $phases.Count
$currentPhase = 0
$startTime = Get-Date

foreach ($phase in $phases) {
    $currentPhase++
    $phaseStart = Get-Date

    Write-Host ""
    Write-Host "========================================"
    Write-Host "  [$currentPhase/$totalPhases] $($phase.Name)"
    Write-Host "  Started: $(Get-Date -Format 'HH:mm:ss')"
    Write-Host "========================================"
    Write-Host ""

    $prompt = Get-Content -Path $phase.File -Raw

    claude --dangerously-skip-permissions -p $prompt

    $phaseEnd = Get-Date
    $phaseDuration = $phaseEnd - $phaseStart

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "WARNING: $($phase.Name) exited with code $LASTEXITCODE (took $($phaseDuration.ToString('hh\:mm\:ss')))"
        $continue = Read-Host "Continue to next phase? (y/n)"
        if ($continue -ne "y") {
            Write-Host "Aborted."
            exit 1
        }
    } else {
        Write-Host ""
        Write-Host "  COMPLETED: $($phase.Name) (took $($phaseDuration.ToString('hh\:mm\:ss')))"
        Write-Host ""
    }
}

$endTime = Get-Date
$totalDuration = $endTime - $startTime

Write-Host ""
Write-Host "========================================"
Write-Host "  FULL REBUILD COMPLETE"
Write-Host "  Total time: $($totalDuration.ToString('hh\:mm\:ss'))"
Write-Host "  Finished: $(Get-Date -Format 'HH:mm:ss')"
Write-Host "========================================"
Write-Host ""
Write-Host "NEXT STEPS:"
Write-Host ""
Write-Host "  Step 1: Commit"
Write-Host "    git init"
Write-Host "    git add -A"
Write-Host "    git commit -m 'PixelPusher rebuilt from scratch - all features, all fixes'"
Write-Host "    git tag v1.0.0-rebuild"
Write-Host ""
Write-Host "  Step 2: Test"
Write-Host "    npm run test"
Write-Host "    npm run dev"
Write-Host ""
Write-Host "  Step 3: Stress test"
Write-Host "    npm run stress:ladder"
Write-Host ""
Write-Host "  Step 4: Build installer"
Write-Host "    npm run dist"
Write-Host ""
Write-Host "  Step 5: PUSH TO GITHUB THIS TIME"
Write-Host "    gh repo create pixelpusher --private"
Write-Host "    git remote add origin https://github.com/YOUR_USERNAME/pixelpusher.git"
Write-Host "    git push -u origin master"
Write-Host ""
