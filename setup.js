#!/usr/bin/env node
'use strict';

/**
 * setup.js — first-time installer.
 *
 * Instead of telling a new user "open .env and paste your token", this
 * asks for each value directly and writes .env for them. It intentionally
 * only asks about the handful of values people actually need to choose;
 * everything else gets a sensible default that's still visible (and
 * editable) in the .env file it writes, with a pointer to .env.example
 * for anyone who wants to understand or change it later.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_FILE_PATH = path.join(__dirname, '.env');

async function main() {
  console.log('StreakKeeper Setup\n──────────────────');

  if (fs.existsSync(ENV_FILE_PATH)) {
    const overwriteAnswer = await ask('An .env file already exists here. Overwrite it? (y/N): ');
    if (overwriteAnswer.trim().toLowerCase() !== 'y') {
      console.log('Setup cancelled — your existing .env was left untouched.');
      return;
    }
  }

  const repositoryUrl = await ask('GitHub repository URL (e.g. https://github.com/you/streakkeeper-log): ');

  printTokenInstructions(repositoryUrl.trim());
  const githubToken = await ask('Paste the token here: ');

  const { botToken, chatId } = await askAboutTelegram();

  writeEnvFile({ repositoryUrl, githubToken, botToken, chatId });
  console.log('\n.env written.');

  createRequiredFolders();
  console.log('Required folders verified (logs/, data/).');

  console.log('\nNothing to create on GitHub — StreakKeeper makes the streak log file itself on its first run.');
  console.log(`
Setup complete. Three commands left:

  node manage.js check-auth   confirm GitHub accepts your token
  node manage.js start        start maintaining your streak
  node manage.js autostart    keep it running after a reboot

That last one matters — without it, StreakKeeper stops when your
computer restarts and your streak quietly stops being maintained.
`);
}

/**
 * Telegram is offered, not demanded. Making it mandatory would put a
 * conversation with BotFather between a new user and their first working
 * commit, which is a lot of friction for a feature many people won't want.
 */
async function askAboutTelegram() {
  console.log('\n── Telegram notifications (optional) ──');
  console.log('StreakKeeper can message you when a commit succeeds or something breaks.');
  console.log('You can skip this now and add it later.');

  const wantsTelegram = await ask('\nSet up Telegram notifications? (y/N): ');
  if (wantsTelegram.trim().toLowerCase() !== 'y') {
    console.log('Skipping — StreakKeeper will run without notifications.');
    return { botToken: '', chatId: '' };
  }

  console.log('\n  1. Open Telegram and message @BotFather');
  console.log('  2. Send /newbot and follow the prompts');
  console.log('  3. BotFather replies with a token like 123456789:ABCdef...');
  const botToken = await ask('\nPaste the Bot Token here: ');

  console.log('\n  4. Now open a chat with YOUR OWN bot and send it any message.');
  console.log('     (Telegram bots cannot message you until you message them first.)');
  await ask('\nPress Enter once you have messaged your bot: ');

  const chatId = await findChatId(botToken.trim());
  return { botToken, chatId };
}

async function findChatId(botToken) {
  try {
    const { discoverChatIds } = require('./src/notify/telegram');
    const chats = await discoverChatIds(botToken);

    if (chats.length === 1) {
      console.log(`\nFound your chat ID automatically: ${chats[0].id} (${chats[0].name})`);
      return String(chats[0].id);
    }

    if (chats.length > 1) {
      console.log('\nSeveral chats have messaged this bot:');
      for (const chat of chats) {
        console.log(`  ${chat.id}   (${chat.type} — ${chat.name})`);
      }
      return (await ask('\nWhich chat ID should notifications go to? ')).trim();
    }

    console.log('\nNo messages found for this bot yet.');
  } catch (error) {
    console.log(`\nCould not reach Telegram: ${error.message}`);
  }

  console.log('You can find your chat ID later with: node manage.js telegram-id');
  return (await ask('Telegram Chat ID (or leave blank to skip): ')).trim();
}

function printTokenInstructions(repositoryUrl) {
  console.log(`
Now create a GitHub token so StreakKeeper can commit for you:
  1. Open https://github.com/settings/personal-access-tokens/new
  2. Token name:        streakkeeper
  3. Expiration:        the longest period you're comfortable with
  4. Repository access: "Only select repositories" → ${repositoryUrl || 'your repository'}
  5. Permissions:       Repository permissions → Contents → "Read and write"
  6. Generate the token and copy it.
`);
}

function writeEnvFile({ repositoryUrl, githubToken, botToken, chatId }) {
  const envFileContents = [
    `GITHUB_TOKEN=${githubToken.trim()}`,
    `GITHUB_REPOSITORY_URL=${repositoryUrl.trim()}`,
    `TELEGRAM_BOT_TOKEN=${botToken.trim()}`,
    `TELEGRAM_CHAT_ID=${chatId.trim()}`,
    '',
    '# Advanced settings — see .env.example for what each one does.',
    'GITHUB_BRANCH_NAME=main',
    'STREAK_LOG_FILE_PATH=streak-log.md',
    'TIMEZONE=UTC',
    'GITHUB_COMMIT_AUTHOR_NAME=',
    'GITHUB_COMMIT_AUTHOR_EMAIL=',
    'LOG_DIRECTORY=logs',
    'STATE_FILE_PATH=data/state.json',
    'RETRY_MAX_ATTEMPTS=5',
    'RETRY_BASE_DELAY_MS=30000',
    'DRY_RUN=false',
    'DEBUG=false',
    '',
  ].join('\n');

  fs.writeFileSync(ENV_FILE_PATH, envFileContents);
}

function createRequiredFolders() {
  for (const folderName of ['logs', 'data']) {
    fs.mkdirSync(path.join(__dirname, folderName), { recursive: true });
  }
}

function ask(question) {
  const readlineInterface = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    readlineInterface.question(question, (answer) => {
      readlineInterface.close();
      resolve(answer);
    });
  });
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
