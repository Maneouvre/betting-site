CREATE DATABASE IF NOT EXISTS matchmate
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE matchmate;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_number VARCHAR(24) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  mpesa_phone VARCHAR(24) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('player', 'admin') NOT NULL DEFAULT 'player',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_account_number (account_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  matched_bet_id BIGINT UNSIGNED NULL,
  bet_type ENUM('football', 'konami') NOT NULL,
  fixture_id VARCHAR(32) NULL,
  fixture_home VARCHAR(100) NULL,
  fixture_away VARCHAR(100) NULL,
  kickoff_at DATETIME NULL,
  selection VARCHAR(100) NULL,
  stake BIGINT UNSIGNED NOT NULL,
  user_paid TINYINT(1) NOT NULL DEFAULT 0,
  payment_approved TINYINT(1) NOT NULL DEFAULT 0,
  payment_method ENUM('send_money', 'till') NULL,
  payment_reference VARCHAR(40) NULL,
  room_code VARCHAR(40) NULL,
  status ENUM(
    'open',
    'awaiting_payment',
    'awaiting_code',
    'paid',
    'won',
    'lost',
    'tie',
    'refunded',
    'completed',
    'cancelled'
  ) NOT NULL DEFAULT 'open',
  pay_deadline DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  payout_sent_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_bets_matching (bet_type, fixture_id, stake, status),
  KEY idx_bets_user_status (user_id, status),
  CONSTRAINT fk_bets_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_bets_matched FOREIGN KEY (matched_bet_id) REFERENCES bets (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS match_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bet_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  claimed_result ENUM('win', 'loss', 'tie') NOT NULL,
  score VARCHAR(40) NULL,
  reported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_match_reports_bet_user (bet_id, user_id),
  CONSTRAINT fk_reports_bet FOREIGN KEY (bet_id) REFERENCES bets (id),
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;
