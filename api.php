<?php
declare(strict_types=1);

require __DIR__ . '/config.php';
date_default_timezone_set('UTC');
const MANAGER_FEE_PERCENT = 10;

ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Strict'
]);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function requestData(): array
{
    $input = file_get_contents('php://input');
    $data = json_decode($input === false ? '' : $input, true);
    if (!is_array($data)) {
        respond(['error' => 'Send a valid JSON request.'], 400);
    }
    return $data;
}

function currentUser(PDO $db): ?array
{
    if (!isset($_SESSION['user_id'])) {
        return null;
    }
    $query = $db->prepare('SELECT id, account_number, full_name, mpesa_phone, role FROM users WHERE id = ?');
    $query->execute([$_SESSION['user_id']]);
    $user = $query->fetch();
    if (!$user) {
        unset($_SESSION['user_id']);
        return null;
    }
    return $user;
}

function requirePlayer(PDO $db): array
{
    $user = currentUser($db);
    if (!$user) {
        respond(['error' => 'Sign in to continue.'], 401);
    }
    return $user;
}

function requireAdmin(PDO $db): array
{
    $user = requirePlayer($db);
    if ($user['role'] !== 'admin') {
        respond(['error' => 'An administrator account is required.'], 403);
    }
    return $user;
}

function publicUser(array $user): array
{
    return [
        'id' => (int)$user['id'],
        'account' => $user['account_number'],
        'name' => $user['full_name'],
        'phone' => $user['mpesa_phone'],
        'role' => $user['role']
    ];
}

function fixtures(): array
{
    $now = time();
    $base = (int)(ceil($now / 900) * 900);
    $definitions = [
        ['demo-1', 'Premier League · Sample', 'Arsenal', 'Chelsea', 'ARS', 'CHE', 2],
        ['demo-2', 'La Liga · Sample', 'Barcelona', 'Real Madrid', 'BAR', 'RMA', 8],
        ['demo-3', 'Serie A · Sample', 'Inter', 'AC Milan', 'INT', 'MIL', 27],
        ['demo-4', 'Bundesliga · Sample', 'Bayern Munich', 'Dortmund', 'BAY', 'DOR', 51],
        ['demo-5', 'Ligue 1 · Sample', 'PSG', 'Marseille', 'PSG', 'OLM', 75],
        ['demo-6', 'Premier League · Sample', 'Liverpool', 'Manchester City', 'LIV', 'MCI', 99]
    ];
    $result = [];
    foreach ($definitions as [$id, $league, $home, $away, $homeCode, $awayCode, $hours]) {
        $kickoff = $base + $hours * 3600;
        $result[] = [
            'id' => $id,
            'league' => $league,
            'home' => $home,
            'away' => $away,
            'homeCode' => $homeCode,
            'awayCode' => $awayCode,
            'starts' => $kickoff * 1000
        ];
    }
    return $result;
}

function findFixture(string $id): ?array
{
    foreach (fixtures() as $fixture) {
        if ($fixture['id'] === $id) {
            return $fixture;
        }
    }
    return null;
}

function betRecord(array $row): array
{
    $stake = (int)$row['stake'];
    $breakdown = payoutBreakdown($stake);
    $winnerRecorded = in_array($row['status'], ['won', 'completed'], true);
    return [
        'id' => (int)$row['id'],
        'type' => $row['bet_type'],
        'fixtureId' => $row['fixture_id'],
        'home' => $row['fixture_home'],
        'away' => $row['fixture_away'],
        'kickoff' => $row['kickoff_at'] ? strtotime($row['kickoff_at']) * 1000 : null,
        'pick' => $row['selection'],
        'stake' => $stake,
        'status' => $row['status'],
        'userPaid' => (bool)$row['user_paid'],
        'paymentApproved' => (bool)$row['payment_approved'],
        'paymentMethod' => $row['payment_method'],
        'paymentReference' => $row['payment_reference'],
        'roomCode' => $row['room_code'],
        'createdAt' => strtotime($row['created_at']) * 1000,
        'deadline' => $row['pay_deadline'] ? strtotime($row['pay_deadline']) * 1000 : null,
        'opponent' => $row['opponent_id'] ? [
            'id' => (int)$row['opponent_id'],
            'name' => $row['opponent_name'],
            'account' => $row['opponent_account']
        ] : null,
        'myReport' => $row['my_report'] ?? null,
        'opponentReport' => $row['opponent_report'] ?? null,
        'grossPot' => $breakdown['grossPot'],
        'managerFeePercent' => MANAGER_FEE_PERCENT,
        'managerFee' => $winnerRecorded ? $breakdown['managerFee'] : 0,
        'potentialManagerFee' => $breakdown['managerFee'],
        'potentialPayout' => $breakdown['payout'],
        'payout' => $winnerRecorded ? $breakdown['payout'] : null,
        'payoutSendMoneyFee' => $winnerRecorded ? $breakdown['sendMoneyFee'] : null
    ];
}

function payoutBreakdown(int $stake): array
{
    $grossPot = $stake * 2;
    $managerFee = (int)round($grossPot * MANAGER_FEE_PERCENT / 100, 0, PHP_ROUND_HALF_UP);
    $available = $grossPot - $managerFee;
    $finalPayout = null;
    $sendMoneyFee = null;

    if ($available <= 250000) {
        foreach (safaricomFeeBands() as $band) {
            $candidate = min($band['max'], $available - $band['fee']);
            if ($candidate >= $band['min'] && $candidate + $band['fee'] <= $available && ($finalPayout === null || $candidate > $finalPayout)) {
                $finalPayout = $candidate;
                $sendMoneyFee = $band['fee'];
            }
        }
    }

    return [
        'grossPot' => $grossPot,
        'managerFee' => $managerFee,
        'sendMoneyFee' => $sendMoneyFee,
        'payout' => $finalPayout
    ];
}

function safaricomSendMoneyFee(int $amount): ?int
{
    foreach (safaricomFeeBands() as $band) {
        if ($amount >= $band['min'] && $amount <= $band['max']) {
            return $band['fee'];
        }
    }
    return null;
}

function safaricomFeeBands(): array
{
    return [
        ['min' => 1, 'max' => 49, 'fee' => 0],
        ['min' => 50, 'max' => 100, 'fee' => 0],
        ['min' => 101, 'max' => 500, 'fee' => 7],
        ['min' => 501, 'max' => 1000, 'fee' => 13],
        ['min' => 1001, 'max' => 1500, 'fee' => 23],
        ['min' => 1501, 'max' => 2500, 'fee' => 33],
        ['min' => 2501, 'max' => 3500, 'fee' => 53],
        ['min' => 3501, 'max' => 5000, 'fee' => 57],
        ['min' => 5001, 'max' => 7500, 'fee' => 78],
        ['min' => 7501, 'max' => 10000, 'fee' => 90],
        ['min' => 10001, 'max' => 15000, 'fee' => 100],
        ['min' => 15001, 'max' => 20000, 'fee' => 105],
        ['min' => 20001, 'max' => 35000, 'fee' => 108],
        ['min' => 35001, 'max' => 50000, 'fee' => 108],
        ['min' => 50001, 'max' => 250000, 'fee' => 108]
    ];
}

function loadBet(PDO $db, int $id, bool $lock = false): ?array
{
    $sql = 'SELECT b.*, other.id AS opponent_id, u.account_number AS opponent_account,
                   u.full_name AS opponent_name
            FROM bets b
            LEFT JOIN bets other ON other.id = b.matched_bet_id
            LEFT JOIN users u ON u.id = other.user_id
            WHERE b.id = ?';
    if ($lock) {
        $sql .= ' FOR UPDATE';
    }
    $query = $db->prepare($sql);
    $query->execute([$id]);
    $row = $query->fetch();
    return $row ?: null;
}

function refreshBetStatuses(PDO $db, int $id): void
{
    $bet = loadBet($db, $id, true);
    if (!$bet || !$bet['matched_bet_id'] || !in_array($bet['status'], ['awaiting_payment', 'awaiting_code', 'paid'], true)) {
        return;
    }
    $opponent = loadBet($db, (int)$bet['matched_bet_id'], true);
    if (!$opponent || !in_array($opponent['status'], ['awaiting_payment', 'awaiting_code', 'paid'], true)) {
        return;
    }

    foreach ([$bet, $opponent] as $participant) {
        $status = !(bool)$participant['user_paid'] || !(bool)$participant['payment_approved']
            ? 'awaiting_payment'
            : ($participant['bet_type'] === 'konami' && !$participant['room_code'] ? 'awaiting_code' : 'paid');
        $update = $db->prepare('UPDATE bets SET status = ? WHERE id = ?');
        $update->execute([$status, $participant['id']]);
    }
}

function assertBeforeDeadline(array $bet): void
{
    if (!$bet['pay_deadline'] || strtotime($bet['pay_deadline']) <= time()) {
        respond(['error' => 'The payment window has closed. This match cannot continue.'], 409);
    }
}

function priorKonamiPairIsSettled(PDO $db, int $userId, int $opponentId): bool
{
    $query = $db->prepare(
        "SELECT b.status AS player_status, other.status AS opponent_status
         FROM bets b
         JOIN bets other ON other.id = b.matched_bet_id
         WHERE b.bet_type = 'konami'
           AND other.bet_type = 'konami'
           AND b.user_id = ?
           AND other.user_id = ?
           AND b.id < other.id"
    );
    $query->execute([$userId, $opponentId]);
    foreach ($query->fetchAll() as $pair) {
        $statuses = [$pair['player_status'], $pair['opponent_status']];
        sort($statuses);
        if (!in_array($statuses, [['completed', 'lost'], ['lost', 'won'], ['refunded', 'refunded']], true)) {
            return false;
        }
    }
    return true;
}

function reportsAgree(array $first, array $second): ?string
{
    if ($first['claimed_result'] === 'tie' && $second['claimed_result'] === 'tie') {
        return 'tie';
    }
    if ($first['claimed_result'] === 'win' && $second['claimed_result'] === 'loss') {
        return (string)$first['bet_id'];
    }
    if ($first['claimed_result'] === 'loss' && $second['claimed_result'] === 'win') {
        return (string)$second['bet_id'];
    }
    return null;
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['error' => 'Use POST for API requests.'], 405);
    }

    $data = requestData();
    $action = $data['action'] ?? '';
    $db = database();

    if ($action === 'auth.register') {
        $name = trim((string)($data['name'] ?? ''));
        $phone = trim((string)($data['phone'] ?? ''));
        $password = (string)($data['password'] ?? '');
        if (mb_strlen($name) < 2 || mb_strlen($name) > 100 || strlen(preg_replace('/\D/', '', $phone)) < 9 || strlen($password) < 8 || strlen($password) > 200) {
            respond(['error' => 'Enter your name, a valid M-Pesa number, and a password with at least 8 characters.'], 422);
        }
        $account = '';
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = 'MM-' . date('Y') . '-' . random_int(10000, 99999);
            $check = $db->prepare('SELECT id FROM users WHERE account_number = ?');
            $check->execute([$candidate]);
            if (!$check->fetch()) {
                $account = $candidate;
                break;
            }
        }
        if ($account === '') {
            respond(['error' => 'Could not assign an account number. Please try again.'], 500);
        }
        $insert = $db->prepare('INSERT INTO users (account_number, full_name, mpesa_phone, password_hash) VALUES (?, ?, ?, ?)');
        $insert->execute([$account, $name, $phone, password_hash($password, PASSWORD_DEFAULT)]);
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$db->lastInsertId();
        $query = $db->prepare('SELECT id, account_number, full_name, mpesa_phone, role FROM users WHERE id = ?');
        $query->execute([$_SESSION['user_id']]);
        respond(['user' => publicUser($query->fetch())], 201);
    }

    if ($action === 'auth.login') {
        $account = strtoupper(trim((string)($data['account'] ?? '')));
        $password = (string)($data['password'] ?? '');
        $query = $db->prepare('SELECT id, account_number, full_name, mpesa_phone, password_hash, role FROM users WHERE account_number = ?');
        $query->execute([$account]);
        $user = $query->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            respond(['error' => 'Account number or password is incorrect.'], 401);
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['id'];
        respond(['user' => publicUser($user)]);
    }

    if ($action === 'auth.logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        respond(['ok' => true]);
    }

    if ($action === 'auth.session') {
        $user = currentUser($db);
        respond(['user' => $user ? publicUser($user) : null]);
    }

    if ($action === 'fixtures.list') {
        respond(['fixtures' => fixtures()]);
    }

    if ($action === 'fees.list') {
        respond([
            'managerFeePercent' => MANAGER_FEE_PERCENT,
            'sendMoneyBands' => safaricomFeeBands(),
            'tariffNotice' => 'Send Money bands supplied by the user; not independently verified with Safaricom for 2026. Till/Buy Goods charges are not included. Fees are estimates only and are not deducted from the prize.'
        ]);
    }

    if ($action === 'bets.list') {
        $user = requirePlayer($db);
        $query = $db->prepare(
            'SELECT b.*, other.id AS opponent_id, u.account_number AS opponent_account,
                    u.full_name AS opponent_name, own_report.claimed_result AS my_report,
                    opponent_report.claimed_result AS opponent_report
             FROM bets b
             LEFT JOIN bets other ON other.id = b.matched_bet_id
             LEFT JOIN users u ON u.id = other.user_id
             LEFT JOIN match_reports own_report ON own_report.bet_id = b.id AND own_report.user_id = b.user_id
             LEFT JOIN match_reports opponent_report ON opponent_report.bet_id = other.id AND opponent_report.user_id = other.user_id
             WHERE b.user_id = ?
             ORDER BY b.created_at DESC, b.id DESC'
        );
        $query->execute([$user['id']]);
        respond(['bets' => array_map('betRecord', $query->fetchAll())]);
    }

    if ($action === 'bets.create') {
        $user = requirePlayer($db);
        $type = $data['type'] ?? '';
        $stake = filter_var($data['stake'] ?? null, FILTER_VALIDATE_INT);
        if (!in_array($type, ['football', 'konami'], true) || $stake === false || $stake < 50) {
            respond(['error' => 'Choose a valid game and stake of at least KES 50.'], 422);
        }
        $fixture = null;
        $pick = null;
        if ($type === 'football') {
            $fixture = findFixture((string)($data['fixtureId'] ?? ''));
            $pick = trim((string)($data['pick'] ?? ''));
            if (!$fixture || !in_array($pick, [$fixture['home'], $fixture['away'], 'Draw'], true)) {
                respond(['error' => 'Choose a valid sample fixture and result.'], 422);
            }
            $kickoff = (int)($fixture['starts'] / 1000);
            if ($kickoff - 30 * 60 <= time()) {
                respond(['error' => 'Football betting closes 30 minutes before kick-off.'], 409);
            }
        }

        $db->beginTransaction();
        try {
            $matchSql = "SELECT * FROM bets
                         WHERE bet_type = ? AND stake = ? AND status = 'open' AND user_id <> ?";
            $matchParams = [$type, $stake, $user['id']];
            if ($type === 'football') {
                $matchSql .= ' AND fixture_id = ? AND selection <> ?';
                $matchParams[] = $fixture['id'];
                $matchParams[] = $pick;
            }
            $matchSql .= ' ORDER BY created_at, id LIMIT 1 FOR UPDATE';
            $matchQuery = $db->prepare($matchSql);
            $matchQuery->execute($matchParams);
            $opponentBet = $matchQuery->fetch();
            if ($type === 'konami' && $opponentBet && !priorKonamiPairIsSettled($db, (int)$user['id'], (int)$opponentBet['user_id'])) {
                $db->rollBack();
                respond(['error' => 'A rematch with this player is available only after the previous result is recorded.'], 409);
            }

            $deadline = $type === 'football'
                ? gmdate('Y-m-d H:i:s', (int)($fixture['starts'] / 1000) - 30 * 60)
                : gmdate('Y-m-d H:i:s', time() + 5 * 60);
            $status = 'open';
            $opponentId = null;
            if ($opponentBet) {
                $status = 'awaiting_payment';
                $opponentId = (int)$opponentBet['id'];
                $update = $db->prepare('UPDATE bets SET matched_bet_id = NULL, status = ?, pay_deadline = ? WHERE id = ?');
                $update->execute(['awaiting_payment', $deadline, $opponentId]);
            }

            $insert = $db->prepare(
                'INSERT INTO bets (user_id, bet_type, fixture_id, fixture_home, fixture_away, kickoff_at,
                                   selection, stake, status, pay_deadline)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $insert->execute([
                $user['id'],
                $type,
                $fixture['id'] ?? null,
                $fixture['home'] ?? null,
                $fixture['away'] ?? null,
                isset($fixture['starts']) ? gmdate('Y-m-d H:i:s', (int)($fixture['starts'] / 1000)) : null,
                $pick,
                $stake,
                $status,
                $opponentBet ? $deadline : null
            ]);
            $betId = (int)$db->lastInsertId();
            if ($opponentId !== null) {
                $link = $db->prepare('UPDATE bets SET matched_bet_id = ? WHERE id = ?');
                $link->execute([$betId, $opponentId]);
                $link->execute([$opponentId, $betId]);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }

        $bet = loadBet($db, $betId);
        respond(['bet' => betRecord($bet), 'matched' => $opponentBet !== false], 201);
    }

    if ($action === 'bets.pay' || $action === 'bets.code' || $action === 'bets.cancel') {
        $user = requirePlayer($db);
        $betId = filter_var($data['betId'] ?? null, FILTER_VALIDATE_INT);
        if (!$betId) {
            respond(['error' => 'A valid bet is required.'], 422);
        }
        $db->beginTransaction();
        try {
            $query = $db->prepare('SELECT * FROM bets WHERE id = ? AND user_id = ? FOR UPDATE');
            $query->execute([$betId, $user['id']]);
            $bet = $query->fetch();
            if (!$bet) {
                $db->rollBack();
                respond(['error' => 'Bet not found.'], 404);
            }

            if ($action === 'bets.cancel') {
                if ($bet['status'] !== 'open') {
                    $db->rollBack();
                    respond(['error' => 'Only an unmatched request can be cancelled.'], 409);
                }
                $update = $db->prepare("UPDATE bets SET status = 'cancelled' WHERE id = ?");
                $update->execute([$betId]);
            } else {
                if (!$bet['matched_bet_id']) {
                    $db->rollBack();
                    respond(['error' => 'No opponent has been matched; payment is not available.'], 409);
                }
                assertBeforeDeadline($bet);
                if ($action === 'bets.pay') {
                    $reference = strtoupper(trim((string)($data['paymentReference'] ?? '')));
                    $method = $data['paymentMethod'] ?? '';
                    if ($bet['status'] !== 'awaiting_payment' || $bet['user_paid'] || !in_array($method, ['send_money', 'till'], true) || !preg_match('/^[A-Z0-9-]{6,40}$/', $reference)) {
                        $db->rollBack();
                        respond(['error' => 'Choose Send Money or Till and enter a transaction reference (6–40 letters, numbers, or hyphens).'], 422);
                    }
                    $update = $db->prepare('UPDATE bets SET user_paid = 1, payment_method = ?, payment_reference = ? WHERE id = ?');
                    $update->execute([$method, $reference, $betId]);
                } else {
                    $code = trim((string)($data['roomCode'] ?? ''));
                    if ($bet['bet_type'] !== 'konami' || !$bet['user_paid'] || !$bet['payment_approved'] || $bet['status'] !== 'awaiting_code' || $code === '' || mb_strlen($code) > 40) {
                        $db->rollBack();
                        respond(['error' => 'Wait for admin payment approval, then provide an eFootball room code of up to 40 characters.'], 409);
                    }
                    $update = $db->prepare('UPDATE bets SET room_code = ? WHERE id = ?');
                    $update->execute([$code, $betId]);
                }
                refreshBetStatuses($db, $betId);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
        $bet = loadBet($db, (int)$betId);
        respond(['bet' => betRecord($bet)]);
    }

    if ($action === 'reports.submit') {
        $user = requirePlayer($db);
        $betId = filter_var($data['betId'] ?? null, FILTER_VALIDATE_INT);
        $claim = $data['result'] ?? '';
        $score = trim((string)($data['score'] ?? ''));
        if (!$betId || !in_array($claim, ['win', 'loss', 'tie'], true) || mb_strlen($score) > 40) {
            respond(['error' => 'Choose win, loss, or tie and enter an optional score of up to 40 characters.'], 422);
        }
        $db->beginTransaction();
        try {
            $query = $db->prepare('SELECT * FROM bets WHERE id = ? AND user_id = ? FOR UPDATE');
            $query->execute([$betId, $user['id']]);
            $bet = $query->fetch();
            if (!$bet || $bet['bet_type'] !== 'konami' || $bet['status'] !== 'paid' || !$bet['matched_bet_id']) {
                $db->rollBack();
                respond(['error' => 'Only a completed, paid eFootball game can be reported.'], 409);
            }
            $existing = $db->prepare('SELECT id FROM match_reports WHERE bet_id = ? AND user_id = ?');
            $existing->execute([$betId, $user['id']]);
            if ($existing->fetch()) {
                $db->rollBack();
                respond(['error' => 'Your result has already been submitted for this one-game match.'], 409);
            }
            $insert = $db->prepare('INSERT INTO match_reports (bet_id, user_id, claimed_result, score) VALUES (?, ?, ?, ?)');
            $insert->execute([$betId, $user['id'], $claim, $score === '' ? null : $score]);

            $opponentReportQuery = $db->prepare(
                'SELECT r.bet_id, r.claimed_result
                 FROM match_reports r
                 WHERE r.bet_id = ?'
            );
            $opponentReportQuery->execute([$bet['matched_bet_id']]);
            $opponentReport = $opponentReportQuery->fetch();
            if ($opponentReport) {
                $myReport = ['bet_id' => (string)$betId, 'claimed_result' => $claim];
                $agreedWinner = reportsAgree($myReport, $opponentReport);
                if ($agreedWinner === 'tie') {
                    $update = $db->prepare("UPDATE bets SET status = 'tie', resolved_at = UTC_TIMESTAMP() WHERE id IN (?, ?)");
                    $update->execute([$betId, $bet['matched_bet_id']]);
                } elseif ($agreedWinner !== null) {
                    $winnerId = (int)$agreedWinner;
                    $loserId = $winnerId === (int)$betId ? (int)$bet['matched_bet_id'] : (int)$betId;
                    $update = $db->prepare("UPDATE bets SET status = 'lost', resolved_at = UTC_TIMESTAMP() WHERE id = ?");
                    $update->execute([$loserId]);
                    $update = $db->prepare("UPDATE bets SET status = 'won', resolved_at = UTC_TIMESTAMP() WHERE id = ?");
                    $update->execute([$winnerId]);
                }
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
        respond(['ok' => true]);
    }

    if ($action === 'admin.approvePayment') {
        requireAdmin($db);
        $betId = filter_var($data['betId'] ?? null, FILTER_VALIDATE_INT);
        if (!$betId) {
            respond(['error' => 'A valid bet is required.'], 422);
        }
        $db->beginTransaction();
        try {
            $bet = loadBet($db, (int)$betId, true);
            if (!$bet || !$bet['matched_bet_id'] || $bet['status'] !== 'awaiting_payment' || !$bet['user_paid'] || !$bet['payment_reference']) {
                $db->rollBack();
                respond(['error' => 'This matched player has no pending payment reference to approve.'], 409);
            }
            assertBeforeDeadline($bet);
            $update = $db->prepare('UPDATE bets SET payment_approved = 1 WHERE id = ?');
            $update->execute([$betId]);
            refreshBetStatuses($db, (int)$betId);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
        respond(['ok' => true]);
    }

    if ($action === 'admin.dashboard') {
        requireAdmin($db);
        $query = $db->query(
            'SELECT b.*, u.account_number AS player_account, u.full_name AS player_name,
                    u.mpesa_phone AS player_phone,
                    other.id AS opponent_id, other.status AS opponent_status,
                    opponent_user.account_number AS opponent_account,
                    opponent_user.full_name AS opponent_name,
                    own_report.claimed_result AS my_report,
                    own_report.score AS my_score,
                    other.payment_reference AS opponent_payment_reference,
                    other.payment_approved AS opponent_payment_approved,
                    other.user_paid AS opponent_user_paid,
                    other.payment_method AS opponent_payment_method,
                    opponent_report.claimed_result AS opponent_report,
                    opponent_report.score AS opponent_score
             FROM bets b
             JOIN users u ON u.id = b.user_id
             LEFT JOIN bets other ON other.id = b.matched_bet_id
             LEFT JOIN users opponent_user ON opponent_user.id = other.user_id
             LEFT JOIN match_reports own_report ON own_report.bet_id = b.id AND own_report.user_id = b.user_id
             LEFT JOIN match_reports opponent_report ON opponent_report.bet_id = other.id AND opponent_report.user_id = other.user_id
             ORDER BY b.created_at DESC, b.id DESC'
        );
        $bets = [];
        foreach ($query->fetchAll() as $row) {
            $bets[] = betRecord($row) + [
                'player' => [
                    'name' => $row['player_name'],
                    'account' => $row['player_account'],
                    'phone' => $row['player_phone']
                ],
                'opponentStatus' => $row['opponent_status'],
                'myScore' => $row['my_score'],
                'opponentScore' => $row['opponent_score'],
                'opponentPaymentReference' => $row['opponent_payment_reference'],
                'opponentPaymentApproved' => (bool)$row['opponent_payment_approved'],
                'opponentUserPaid' => (bool)$row['opponent_user_paid']
            ];
        }
        respond(['bets' => $bets]);
    }

    if ($action === 'admin.resolve' || $action === 'admin.markSent' || $action === 'admin.markRefunded') {
        requireAdmin($db);
        $betId = filter_var($data['betId'] ?? null, FILTER_VALIDATE_INT);
        if (!$betId) {
            respond(['error' => 'A valid bet is required.'], 422);
        }
        $db->beginTransaction();
        try {
            $bet = loadBet($db, (int)$betId, true);
            if (!$bet || !$bet['matched_bet_id']) {
                $db->rollBack();
                respond(['error' => 'Matched bet not found.'], 404);
            }
            $other = loadBet($db, (int)$bet['matched_bet_id'], true);
            if (!$other) {
                $db->rollBack();
                respond(['error' => 'Opponent bet not found.'], 404);
            }
            if ($action === 'admin.resolve') {
                $bothReady = (bool)$bet['user_paid'] && (bool)$other['user_paid']
                    && (bool)$bet['payment_approved'] && (bool)$other['payment_approved'];
                if ($bet['bet_type'] === 'konami') {
                    $bothReady = $bothReady && (bool)$bet['room_code'] && (bool)$other['room_code'];
                    $reports = $db->prepare('SELECT COUNT(*) FROM match_reports WHERE bet_id IN (?, ?)');
                    $reports->execute([$bet['id'], $other['id']]);
                    if ((int)$reports->fetchColumn() !== 2) {
                        $db->rollBack();
                        respond(['error' => 'Both eFootball players must submit their result before admin review.'], 409);
                    }
                }
                if (!$bothReady || !in_array($bet['status'], ['paid'], true) || !in_array($other['status'], ['paid'], true)) {
                    $db->rollBack();
                    respond(['error' => 'Both players must complete payment, and eFootball players must submit their room codes, before the result can be recorded.'], 409);
                }
                $winnerId = $data['winnerBetId'] ?? null;
                if ($winnerId === 'tie') {
                    $update = $db->prepare("UPDATE bets SET status = 'tie', resolved_at = UTC_TIMESTAMP() WHERE id IN (?, ?)");
                    $update->execute([$bet['id'], $other['id']]);
                } elseif (in_array((int)$winnerId, [(int)$bet['id'], (int)$other['id']], true)) {
                    $loserId = (int)$winnerId === (int)$bet['id'] ? (int)$other['id'] : (int)$bet['id'];
                    $update = $db->prepare("UPDATE bets SET status = 'lost', resolved_at = UTC_TIMESTAMP() WHERE id = ?");
                    $update->execute([$loserId]);
                    $update = $db->prepare("UPDATE bets SET status = 'won', resolved_at = UTC_TIMESTAMP() WHERE id = ?");
                    $update->execute([(int)$winnerId]);
                } else {
                    $db->rollBack();
                    respond(['error' => 'Choose one of the matched players or a tie.'], 422);
                }
            } elseif ($action === 'admin.markSent') {
                if ($bet['status'] !== 'won') {
                    $db->rollBack();
                    respond(['error' => 'Only an unpaid winner can be marked as paid out.'], 409);
                }
                if (payoutBreakdown((int)$bet['stake'])['payout'] === null) {
                    $db->rollBack();
                    respond(['error' => 'No Safaricom Send Money fee band is configured for this payout amount.'], 409);
                }
                $update = $db->prepare("UPDATE bets SET status = 'completed', payout_sent_at = UTC_TIMESTAMP() WHERE id = ?");
                $update->execute([$betId]);
            } else {
                if ($bet['status'] !== 'tie' || $other['status'] !== 'tie') {
                    $db->rollBack();
                    respond(['error' => 'Only a tied match can be marked as refunded.'], 409);
                }
                $update = $db->prepare("UPDATE bets SET status = 'refunded', payout_sent_at = UTC_TIMESTAMP() WHERE id IN (?, ?)");
                $update->execute([$bet['id'], $other['id']]);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
        respond(['ok' => true]);
    }

    respond(['error' => 'Unknown API action.'], 404);
} catch (PDOException $error) {
    error_log('MatchMate database error: ' . $error->getMessage());
    respond(['error' => 'The database is unavailable. Check the MySQL service and DB settings.'], 503);
} catch (Throwable $error) {
    error_log('MatchMate API error: ' . $error->getMessage());
    respond(['error' => 'The request could not be completed. Check the server logs for details.'], 500);
}
