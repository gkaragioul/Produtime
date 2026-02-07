param(
    [string]$KeyPath = "$env:USERPROFILE\Documents\Scripts\Timeport\.ssh\produtime_vps.pub"
)

if (!(Test-Path $KeyPath)) { throw "Public key not found at $KeyPath" }

# Read the public key exactly (single line)
$pub = (Get-Content $KeyPath -Raw).TrimEnd("`r","`n")
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pub))

# One-liner for the DigitalOcean console (paste as root)
$remote = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && printf '%s' '$base64' | base64 -d > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'authorized_keys updated'"

# Try to copy to clipboard; ignore if clipboard isn't available
try { $remote | Set-Clipboard } catch { }

$remote

