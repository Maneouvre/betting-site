<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Strict'
]);
session_start();

if (!isset($_SESSION['user_id'])) {
    header('Location: index.html?admin=login', true, 302);
    exit;
}

$query = database()->prepare('SELECT role, full_name FROM users WHERE id = ?');
$query->execute([$_SESSION['user_id']]);
$user = $query->fetch();

if (!$user || $user['role'] !== 'admin') {
    if (!$user) {
        $_SESSION = [];
        session_destroy();
    }
    header('Location: index.html?admin=denied', true, 302);
    exit;
}

header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0b171b">
    <title>Admin dashboard · MatchMate</title>
    <link rel="stylesheet" href="styles.css">
    <script src="admin.js" defer></script>
  </head>
  <body>
    <div class="admin-shell">
      <header class="admin-topbar">
        <a class="brand" href="index.html" aria-label="MatchMate home">
          <span class="brand-mark">M</span><span>match<span class="brand-light">mate</span></span>
        </a>
        <div class="admin-topbar-actions">
          <span class="admin-signed-in">Administrator · <?= htmlspecialchars($user['full_name'], ENT_QUOTES, 'UTF-8') ?></span>
          <a class="secondary-button" href="index.html">Player site</a>
          <button class="secondary-button" id="admin-sign-out" type="button">Sign out</button>
        </div>
      </header>
      <main class="admin-content">
        <div class="page-heading admin-page-heading">
          <div><div class="eyebrow"><span class="eyebrow-line"></span> OPERATIONS</div><h1>Admin overview<span class="heading-period">.</span></h1><p>Review matches, confirm results, and track manual payouts.</p></div>
          <div class="admin-demo-pill"><span class="live-dot"></span> LOCAL DEMO DATA</div>
        </div>
        <div class="admin-stats">
          <div class="admin-stat-card"><span>OPEN MATCHES</span><strong id="admin-open">0</strong><small>Awaiting a player</small></div>
          <div class="admin-stat-card"><span>PAYMENT REVIEW</span><strong id="admin-payment">0</strong><small>References awaiting admin approval</small></div>
          <div class="admin-stat-card"><span>WINNERS TO PAY</span><strong id="admin-winners">0</strong><small>Manual payout required</small></div>
          <div class="admin-stat-card"><span>MANAGER FEES EARNED</span><strong id="admin-fees">KES 0</strong><small>10% of resolved winning pots</small></div>
          <div class="admin-stat-card accent-stat"><span>TOTAL TO PAY</span><strong id="admin-total">KES 0</strong><small>After 10% manager fee</small></div>
        </div>
        <div class="admin-toolbar"><div><h2>Winner payouts</h2><p>Winner and opponent details are visible to the admin.</p></div><button class="secondary-button" id="export-winners" type="button">↓ Export list</button></div>
        <div class="table-wrap"><table class="admin-table"><thead><tr><th>WINNER / ACCOUNT</th><th>LOSING OPPONENT</th><th>BET</th><th>MANAGER FEE</th><th>AMOUNT TO RECEIVE</th><th>SEND MONEY FEE</th><th>M-PESA DETAILS</th><th>STATUS</th><th></th></tr></thead><tbody id="winners-table"></tbody></table></div>
        <div class="admin-toolbar queue-toolbar"><div><h2>Open betmate requests</h2><p>Unmatched players looking for a mate, including stake, fixture or eFootball squad strength.</p></div></div>
        <div class="table-wrap"><table class="admin-table request-table"><thead><tr><th>PLAYER / ACCOUNT</th><th>GAME</th><th>TEAMS / SELECTION</th><th>TEAM STRENGTH</th><th>STAKE</th><th>REQUESTED</th></tr></thead><tbody id="requests-table"></tbody></table></div>
        <div class="admin-toolbar queue-toolbar"><div><h2>Matched players &amp; payment review</h2><p>Players are paired before payment. Both equal stakes and payment references are shown together.</p></div></div>
        <div class="table-wrap"><table class="admin-table queue-table"><thead><tr><th>PLAYER / ACCOUNT</th><th>TYPE</th><th>FIXTURE / RESULT CLAIM</th><th>OPPONENT</th><th>STAKE EACH</th><th>PAYMENT REFERENCES</th><th>MATCH STATUS</th><th>ADMIN ACTION</th></tr></thead><tbody id="queue-table"></tbody></table></div>
        <div class="admin-disclaimer">This prototype stores records in MySQL. Payment references must be checked manually in the M-Pesa account; no payment is initiated or automatically verified. Player result agreement is not independent proof of an eFootball result.</div>
      </main>
    </div>
    <div id="modal-root"></div>
    <div id="toast-region" class="toast-region" aria-live="polite"></div>
  </body>
</html>
