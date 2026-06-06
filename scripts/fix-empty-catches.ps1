param([string]$SrcDir = "src")

$ErrorActionPreference = "Stop"
$totalFixed = 0
$modifiedFiles = @()

Get-ChildItem -Recurse -Filter "*.js" -Path $SrcDir | ForEach-Object {
    $filePath = $_.FullName
    $relPath = $_.FullName -replace '.*src[\\/]', ''
    $content = Get-Content $filePath -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return }

    $original = $content
    $fixed = 0

    # Fix pattern 1: catch {} (no variable)
    $pattern1 = 'catch\s*\{\s*\}'
    $replacement1 = 'catch (err) { logger.error("Unhandled error in ' + $relPath + '", { error: err?.message }) }'
    if ($content -match $pattern1) {
        $content = $content -replace $pattern1, $replacement1
        $fixed++
    }

    # Fix pattern 2: catch { /* comment */ }
    $content = $content -replace 'catch\s*\{\s*/\*.*?\*/\s*\}', 'catch (err) { logger.error("Unhandled error in ' + $relPath + '", { error: err?.message }) }'

    if ($content -ne $original) {
        # Add logger import if missing
        $hasLogger = $content -match "require.*logger"
        if (-not $hasLogger) {
            $depth = ($relPath -split '[\\/]').Length - 1
            $prefix = if ($depth -gt 0) { "../" * $depth } else { "./" }
            $importLine = "const { logger } = require('${prefix}utils/logger');`n"
            # Insert after first require or at top
            if ($content -match '(?m)^const\s+\w+\s*=\s*require\([^)]+\);') {
                $content = $content -replace '(?m)(^const\s+\w+\s*=\s*require\([^)]+\);)', "`$1`n$importLine"
            } else {
                $content = $importLine + $content
            }
        }

        Set-Content $filePath -Value $content -NoNewline -Encoding UTF8
        $totalFixed += $fixed
        $modifiedFiles += $relPath
        Write-Host "  $relPath : $fixed fixed"
    }
}

Write-Host "`nTotal: $totalFixed empty catch blocks fixed in $($modifiedFiles.Count) files"
$totalFixed | Out-File -FilePath "reports/catch-fix-count.txt"
