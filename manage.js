#!/usr/bin/env node
'use strict';

/**
 * manage.js — StreakKeeper's control panel.
 *
 * Wraps PM2 (via its CLI, shelled out to — PM2 is expected to already be
 * installed globally: `npm install -g pm2`) plus a handful of StreakKeeper-
 * specific commands, so day-to-day usage never requires remembering raw
 * PM2 syntax or reaching into src/ directly.
 */

const { execSync } = require('child_process');
const path = require('path');
const { getConfig } = require('./src/config');
const { verifyGitHubAccess, printTokenSetupInstructions } = require('./src/auth');
const notify = require('./src/notify/telegram');

const PROCESS_NAME = 'streakkeeper';
const ECOSYSTEM_FILE_PATH = path.join(__dirname, 'ecosystem.config.js');

const COMMANDS = {
  auth: handleAuth,
  start: handleStart,
  stop: handleStop,
  restart: handleRestart,
  'run-now': handleRunNow,
  status: handleStatus,
  logs: handleLogs,
  config: handleShowConfig,
  'test-telegram': handleTestTelegram,
  'telegram-id': handleTelegramId,
  'check-auth': handleCheckAuth,
  autostart: handleAutostart,
};

async function main() {
  const commandName = process.argv[2];
  const handler = COMMANDS[commandName];

  if (!handler) {
    printUsage();
    process.exit(commandName ? 1 : 0);
  }

  await handler();
}

function printUsage() {
  console.log(`
StreakKeeper management commands:

  node manage.js auth            Show how to create the GitHub token, then check it
  node manage.js start           Start monitoring under PM2
  node manage.js stop            Stop monitoring
  node manage.js restart         Restart monitoring
  node manage.js run-now         Run one hourly check immediately, outside the schedule
  node manage.js status          Show a status report
  node manage.js logs            Tail StreakKeeper's PM2 logs
  node manage.js config          Print the loaded configuration (secrets redacted)
  node manage.js test-telegram   Send a test Telegram message
  node manage.js telegram-id     Find your Telegram chat ID
  node manage.js check-auth      Verify the GitHub token still works
  node manage.js autostart       Make StreakKeeper restart automatically after a reboot
`);
}

async function handleAuth() {
  printTokenSetupInstructions();
  await handleCheckAuth();
}

function handleStart() {
  execSync(`pm2 start "${ECOSYSTEM_FILE_PATH}"`, { stdio: 'inherit' });
}

function handleStop() {
  execSync(`pm2 stop ${PROCESS_NAME}`, { stdio: 'inherit' });
}

function handleRestart() {
  execSync(`pm2 restart ${PROCESS_NAME}`, { stdio: 'inherit' });
}

async function handleRunNow() {
  const { runHourlyCheck } = require('./src/scheduler');
  await runHourlyCheck();
}

async function handleStatus() {
  const state = require('./src/state');
  const config = getConfig();
  const canReachGitHub = await verifyGitHubAccess();
  const lastRunDate = state.readLastSuccessfulRunDate();

  console.log('────────────────────────────────');
  console.log('StreakKeeper Status');
  console.log('────────────────────────────────');
  console.log(`Repository        ${config.github.repositoryUrl}`);
  console.log(`GitHub token      ${canReachGitHub ? 'Working' : 'NOT WORKING — run: node manage.js auth'}`);
  console.log(`Telegram          ${config.telegram.enabled ? 'Configured' : 'Off (optional)'}`);
  console.log(`Time zone         ${config.github.timeZone}`);
  console.log(`Today (${config.github.timeZone})`.padEnd(18) + state.getTodayDateString());
  console.log(`Today completed   ${state.hasCompletedToday() ? 'Yes' : 'Not yet'}`);
  console.log(`Last success      ${lastRunDate || 'never'}`);
  console.log(`Dry run mode      ${config.dryRun ? 'ON' : 'off'}`);
  printPm2Status();
  console.log('────────────────────────────────');
}

function printPm2Status() {
  try {
    const rawJson = execSync('pm2 jlist', { stdio: 'pipe' }).toString();
    const processes = JSON.parse(rawJson);
    const streakKeeperProcess = processes.find((processInfo) => processInfo.name === PROCESS_NAME);
    console.log(`PM2 process       ${streakKeeperProcess ? streakKeeperProcess.pm2_env.status : 'not running under PM2'}`);
  } catch {
    console.log('PM2 process       Could not reach PM2 — is it installed? (npm install -g pm2)');
  }
}

function handleLogs() {
  execSync(`pm2 logs ${PROCESS_NAME}`, { stdio: 'inherit' });
}

/**
 * Prints configuration with secrets masked. The GitHub token and Telegram
 * bot token are credentials, and this output routinely ends up pasted into
 * issues and chat windows when someone is debugging.
 */
function handleShowConfig() {
  const config = getConfig();

  const redactedConfig = {
    ...config,
    github: { ...config.github, token: maskSecret(config.github.token) },
    telegram: { ...config.telegram, botToken: maskSecret(config.telegram.botToken) },
  };

  console.log(JSON.stringify(redactedConfig, null, 2));
}

function maskSecret(secret) {
  if (!secret) {
    return '(not set)';
  }
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (${secret.length} chars)`;
}

async function handleTestTelegram() {
  if (!getConfig().telegram.enabled) {
    console.log('Telegram is not configured — StreakKeeper is running without notifications.');
    console.log('To enable them, set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.');
    console.log('Run `node manage.js telegram-id` to find your chat ID.');
    return;
  }

  await notify.sendRawMessage('Hello from StreakKeeper. Telegram integration is working correctly.');
  console.log('Test message sent — check your Telegram chat.');
}

/**
 * Reads the bot token straight from the environment rather than through
 * getConfig(), because this command exists precisely when configuration
 * is still incomplete — validation would reject a .env that has a bot
 * token but no chat ID, which is the exact state you're in while looking
 * for your chat ID.
 */
async function handleTelegramId() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken || botToken.trim() === '') {
    console.log('TELEGRAM_BOT_TOKEN is not set in .env yet.');
    console.log('Get one by messaging @BotFather on Telegram and sending /newbot.');
    process.exitCode = 1;
    return;
  }

  const chats = await notify.discoverChatIds(botToken.trim());

  if (chats.length === 0) {
    console.log('Your bot has not received any messages yet.');
    console.log('Open Telegram, send your bot any message (or press Start), then run this again.');
    process.exitCode = 1;
    return;
  }

  console.log('\nChats that have messaged your bot:\n');
  for (const chat of chats) {
    console.log(`  ${chat.id}   (${chat.type} — ${chat.name})`);
  }
  console.log('\nCopy the number you want into .env as:  TELEGRAM_CHAT_ID=<number>\n');
}

/**
 * PM2 can restore a saved process list on boot, but wiring that up needs a
 * root-owned service definition. `pm2 startup` doesn't do that itself — it
 * prints a command for the user to run with sudo. This wraps both halves
 * in the right order and says plainly which part still needs a human.
 */
function handleAutostart() {
  console.log('Saving the current process list so it can be restored on boot...\n');
  execSync('pm2 save', { stdio: 'inherit' });

  console.log('\nGenerating the boot service command...\n');
  execSync('pm2 startup', { stdio: 'inherit' });

  console.log(`
────────────────────────────────────────────────────────────
If PM2 printed a command starting with "sudo" above, copy it,
run it once, and you're done — StreakKeeper will now start
automatically whenever this computer boots.

Verify after your next reboot with:  node manage.js status
────────────────────────────────────────────────────────────
`);
}

async function handleCheckAuth() {
  const canReachGitHub = await verifyGitHubAccess();
  console.log(
    canReachGitHub
      ? 'GitHub token is working and can reach the repository.'
      : 'GitHub token is missing, expired, or lacks access to the repository.'
  );
  process.exitCode = canReachGitHub ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
