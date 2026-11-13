<?php
declare(strict_types=1);

function database(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) {
        return $connection;
    }

    $host = getenv('DB_HOST');
    $name = getenv('DB_NAME');
    $user = getenv('DB_USER');
    $password = getenv('DB_PASS');
    $missingSettings = [];
    foreach (['DB_HOST' => $host, 'DB_NAME' => $name, 'DB_USER' => $user, 'DB_PASS' => $password] as $setting => $value) {
        if ($value === false) {
            $missingSettings[] = $setting;
        }
    }
    $isLocalRequest = PHP_SAPI === 'cli' || in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
    if ($missingSettings && !$isLocalRequest) {
        throw new RuntimeException('Database environment settings are required on non-local requests: ' . implode(', ', $missingSettings));
    }
    $host = $host === false ? '127.0.0.1' : $host;
    $name = $name === false ? 'matchmate' : $name;
    $user = $user === false ? 'root' : $user;
    $password = $password === false ? '' : $password;

    $connection = new PDO(
        "mysql:host={$host};dbname={$name};charset=utf8mb4",
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]
    );

    return $connection;
}
