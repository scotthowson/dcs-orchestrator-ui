#!/usr/bin/env bash
# Banner set in the DCS style: one per surface (bot profile, alerts, CrowdSec, the desktop
# app, GitHub social previews). Usage: ./make-banners.sh  (needs rsvg-convert)
set -euo pipefail
cd "$(dirname "$0")"
DEFS=$(sed -n '/<defs>/,/<\/defs>/p' bot-avatar.svg)
STACK=$(sed -n '/<!-- shadow under the stack -->/,/<circle cx="774" cy="438" r="9"/p' app-icon.svg | sed 's/cx="512"/cx="0"/g; s/cy="742"/cy="304"/; s/translate(512 618)/translate(0 180)/; s/translate(512 528)/translate(0 90)/; s/translate(512 438)/translate(0 0)/; s/cy="307"/cy="-131"/g; s/cx="250" cy="438"/cx="-262" cy="0"/g; s/cx="774" cy="438"/cx="262" cy="0"/g')
badge() {  # COLOR-GRADIENT INNER-SVG
  cat <<B
  <circle cx="230" cy="130" r="86" fill="#000000" fill-opacity="0.5" filter="url(#badgeShadow)"/>
  <circle cx="230" cy="130" r="80" fill="#0b1220"/>
  <circle cx="230" cy="130" r="80" fill="none" stroke="url(#$1)" stroke-width="7"/>
  <g transform="translate(230 130) scale(0.44)">$2</g>
B
}
SLASH='<g transform="rotate(18)"><rect x="-34" y="-128" width="68" height="256" rx="34" fill="url(#accent)"/></g>'
BELL='<g transform="translate(0 6)"><path d="M-92 46 L-70 22 V-30 A70 70 0 0 1 70 -30 V22 L92 46 Z" fill="url(#amber)" stroke="#fde68a" stroke-opacity="0.6" stroke-width="4" stroke-linejoin="round"/><rect x="-100" y="46" width="200" height="16" rx="8" fill="url(#amber)"/><path d="M-34 74 A34 30 0 0 0 34 74 Z" fill="url(#amber)"/><circle cx="0" cy="-112" r="14" fill="#fde68a"/></g>'
SHIELD='<path d="M0 -150 L120 -100 V20 C120 110 60 160 0 190 C-60 160 -120 110 -120 20 V-100 Z" fill="#0b1220" stroke="url(#violet)" stroke-width="16" stroke-linejoin="round"/><g transform="scale(0.34) translate(0 -30)">'"$STACK"'</g>'
CHECK='<path d="M-64 6 L-14 56 L78 -46" fill="none" stroke="url(#accent)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>'
banner() {  # FILE TITLE SUBTITLE TAGLINE CHIPS BADGE(gradient|inner or "") FOOT W H
  local file="$1" title="$2" sub="$3" tag="$4" chips="$5" badge="$6" foot="$7" w="${8:-1360}" h="${9:-480}"
  local scale="1" ty="0"
  [[ "$h" == "640" ]] && { scale="0.94"; ty="84"; }
  local chipx=0 chipsvg=""
  for c in $chips; do
    local cw=$(( ${#c} * 13 + 46 ))
    chipsvg+="<rect x=\"$chipx\" y=\"0\" width=\"$cw\" height=\"52\" rx=\"26\" fill=\"#0b1220\" stroke=\"url(#accent)\" stroke-width=\"2\"/><text x=\"$((chipx + 24))\" y=\"34\" fill=\"#a7f3d0\">$c</text>"
    chipx=$(( chipx + cw + 16 ))
  done
  cat > "$file.svg" <<S
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $w $h" width="$w" height="$h">
$DEFS
  <linearGradient id="bannerBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1b30"/><stop offset="0.6" stop-color="#070d1a"/><stop offset="1" stop-color="#04070f"/></linearGradient>
  <radialGradient id="bannerGlow" cx="0.22" cy="0.5" r="0.5"><stop offset="0" stop-color="#34d399" stop-opacity="0.35"/><stop offset="0.5" stop-color="#22d3ee" stop-opacity="0.10"/><stop offset="1" stop-color="#0b1220" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 H0 V40" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/></pattern>
  <rect width="$w" height="$h" fill="url(#bannerBg)"/>
  <rect width="$w" height="$h" fill="url(#grid)"/>
  <rect width="$w" height="$h" fill="url(#bannerGlow)"/>
  <g transform="translate(0 $ty) scale($scale)">
  <g transform="translate(300 232) scale(0.62)">
$STACK
    <line x1="0" y1="311" x2="0" y2="400" stroke="#67e8f9" stroke-opacity="0.55" stroke-width="7" stroke-linecap="round"/>
    <circle cx="0" cy="414" r="16" fill="#22d3ee" filter="url(#dotGlow)" fill-opacity="0.9"/><circle cx="0" cy="414" r="11" fill="#a5f3fc"/>
  </g>
  <g transform="translate(210 148)">$( [[ -n "$badge" ]] && badge "${badge%%|*}" "${badge#*|}" )</g>
  <g font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fill="#f8fafc">
    <text x="560" y="196" font-size="96" font-weight="800" letter-spacing="-3">$title</text>
    <text x="562" y="262" font-size="34" font-weight="500" fill="#cbd5e1">$sub</text>
  </g>
  <g transform="translate(562 300)" font-family="'JetBrains Mono', 'Fira Mono', Menlo, Consolas, monospace" font-size="24">$chipsvg</g>
  <g transform="translate(562 386)" font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="22" fill="#64748b"><text x="0" y="0">$tag</text></g>
  <g transform="translate(562 430)" font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="18" fill="#475569"><text x="0" y="0">$foot</text></g>
  </g>
</svg>
S
  rsvg-convert -w "$w" -h "$h" "$file.svg" -o "$file.png"
  echo "$file.png"
}
banner banner-dcs      "DCS"          "DCS Orchestrator"                              "Every stack on your server, one command away."             "start.sh deploy update backup"     ""                 "github.com/scotthowson/Docker-Compose-Skeleton-AIO"
banner banner-commands "DCS Commands" "Slash commands for your server"                 "Status, health, deploys and restarts from Discord, confirmed."  "/status /health /deploy /restart"  "accent|$SLASH"    "Every reply has buttons · destructive actions ask first"
banner banner-alerts   "DCS Alerts"   "Your server, in your channel"                   "Deploys, health, backups, disk space and updates as they happen." "deploys health backups updates" "amber|$BELL"      "One embed per event · cooldowns keep it quiet"
banner banner-crowdsec "CrowdSec × DCS" "Bans at the proxy, explained in plain words"  "Who hit you, from where, how hard, and for how long."       "ssh-bf http-probing exploits"      "violet|$SHIELD"   "Threat intel links on every alert"
banner banner-manager  "Dashboard"    "DCS Orchestrator, in your browser and app" "Desktop, web and mobile · stacks, templates, health, everything." "stacks templates health topology" "accent|$CHECK"   "Linux · Windows · Android · any browser"
banner social-aio      "DCS"          "DCS Orchestrator"                              "Every stack on your server, one command away."             "start.sh deploy update backup"     ""                 "A self-hosted framework with a bash API, templates and a dashboard" 1280 640
banner social-ui       "Dashboard"    "DCS Orchestrator, in your browser and app" "Desktop, web and mobile · stacks, templates, health, everything." "stacks templates health topology" "accent|$CHECK"   "Linux · Windows · Android · any browser" 1280 640
