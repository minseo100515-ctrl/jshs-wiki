$ErrorActionPreference = "Stop"
$env:PATH = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:PATH

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "1) config.js 생성 중..."
node scripts/generate-config.mjs

Write-Host "2) dist/ 빌드 중..."
node scripts/prepare-dist.mjs

Write-Host ""
Write-Host "로컬 미리보기: dist 폴더를 정적 서버로 열면 됩니다."
Write-Host "  python -m http.server 8080 --directory dist"
Write-Host ""
Write-Host "Netlify 배포 (최초 1회 로그인 필요):"
Write-Host "  npx netlify-cli login"
Write-Host "  npx netlify-cli deploy --dir dist --prod"
Write-Host ""
Write-Host "Netlify 환경 변수 (Site settings > Environment variables):"
Write-Host "  SUPABASE_URL"
Write-Host "  SUPABASE_ANON_KEY"
