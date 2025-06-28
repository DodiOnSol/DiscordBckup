require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  PermissionsBitField,
  ActivityType,
  SlashCommandBuilder
} = require('discord.js');
const mysql = require('mysql2/promise');
const fs = require('fs-extra');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const ATTACHMENT_DIR = path.join(__dirname, 'attachments');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

let db;

async function initDatabase() {
  db = await mysql.createConnection({
    host: 'na03-sql.pebblehost.com',
    port: 3306,
    user: 'customer_1043082_DMAScamReport',
    password: 'CUke7kbl.R1VRJD6g1eQ5q+a',
    database: 'customer_1043082_DMAScamReport'
  });

  console.log('✅ Connected to MySQL database');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(50) PRIMARY KEY,
      channel_id VARCHAR(50),
      channel_name VARCHAR(100),
      parent_id VARCHAR(50),
      parent_name VARCHAR(100),
      author VARCHAR(100),
      content TEXT,
      created_at DATETIME
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(50),
      channel_id VARCHAR(50),
      filename VARCHAR(255)
    )
  `);
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('backup')
      .setDescription('Backup the current channel (admin only)'),
    new SlashCommandBuilder()
      .setName('restore')
      .setDescription('Restore all backed-up channels (admin only)')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('🚀 Registering slash commands...');
    const app = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationCommands(app.id), { body: commands });
    console.log('✅ Slash commands registered globally.');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }
}

async function backupChannel(channel) {
  await fs.ensureDir(ATTACHMENT_DIR);

  const messages = await channel.messages.fetch({ limit: 100 });
  const allMessages = Array.from(messages.values()).reverse();

  for (const msg of allMessages) {
    try {
      const parent = msg.channel.parent;
      const parentId = parent?.id || null;
      const parentName = parent?.name || null;

      await db.execute(
        `REPLACE INTO messages (
          id, channel_id, channel_name, parent_id, parent_name,
          author, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id,
          msg.channel.id,
          msg.channel.name,
          parentId,
          parentName,
          msg.author.username,
          msg.content,
          new Date(msg.createdTimestamp)
        ]
      );

      for (const attachment of msg.attachments.values()) {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());

        const fileName = `${msg.id}_${attachment.name}`;
        const filePath = path.join(ATTACHMENT_DIR, fileName);
        await fs.writeFile(filePath, buffer);

        await db.execute(
          `INSERT INTO attachments (message_id, channel_id, filename) VALUES (?, ?, ?)`,
          [msg.id, msg.channel.id, fileName]
        );
      }
    } catch (error) {
      console.warn('⚠️ Error backing up message or attachment:', error.message);
    }
  }

  console.log(`✅ Backup complete for #${channel.name}`);
}

async function restoreBackup(guild) {
  await fs.ensureDir(ATTACHMENT_DIR);

  const [channels] = await db.execute(`
    SELECT DISTINCT channel_id, channel_name, parent_id, parent_name
    FROM messages
  `);

  const categoryMap = {};

  for (const { parent_id, parent_name } of channels) {
    if (!parent_id || categoryMap[parent_id]) continue;

    try {
      const category = await guild.channels.create({
        name: parent_name || 'Restored Category',
        type: 4
      });

      categoryMap[parent_id] = category.id;
    } catch (err) {
      console.warn(`⚠️ Could not create category ${parent_name}:`, err.message);
    }
  }

  for (const { channel_id, channel_name, parent_id } of channels) {
    let newChannel;
    try {
      newChannel = await guild.channels.create({
        name: channel_name,
        type: 0,
        parent: categoryMap[parent_id] || null
      });
    } catch (e) {
      console.warn(`⚠️ Could not create channel ${channel_name}:`, e.message);
      continue;
    }

    const [messages] = await db.execute(
      `SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at ASC`,
      [channel_id]
    );

    for (const msg of messages) {
      const [attachments] = await db.execute(
        `SELECT filename FROM attachments WHERE message_id = ?`,
        [msg.id]
      );

      const files = [];
      for (const attach of attachments) {
        const filePath = path.join(ATTACHMENT_DIR, attach.filename);
        if (await fs.pathExists(filePath)) {
          files.push({ attachment: filePath });
        }
      }

      try {
        await newChannel.send({
          content: `**${msg.author}**: ${msg.content || ''}`,
          files
        });
      } catch (error) {
        console.warn(`⚠️ Failed to restore message:`, error.message);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`✅ Restored #${channel_name}`);
  }
}

function cycleStatus() {
  const messages = process.env.BOT_STATUS_MESSAGES?.split(',') || ['Made by Pengu012', 'Backing up the server'];
  const interval = parseInt(process.env.BOT_STATUS_INTERVAL || '5000', 10);
  const typeStr = process.env.BOT_STATUS_TYPE?.toUpperCase() || 'WATCHING';

  let type = ActivityType.Watching;
  if (typeStr === 'PLAYING') type = ActivityType.Playing;
  else if (typeStr === 'LISTENING') type = ActivityType.Listening;
  else if (typeStr === 'COMPETING') type = ActivityType.Competing;

  let i = 0;
  setInterval(() => {
    client.user.setActivity(messages[i], { type });
    i = (i + 1) % messages.length;
  }, interval);
}

client.once('ready', async () => {
  await initDatabase();
  await registerCommands();
  cycleStatus();
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: '❌ You need to be an admin to use this command.', flags: 64 });
  }

  if (interaction.commandName === 'backup') {
    await interaction.reply({ content: '📦 Backing up this channel...', flags: 64 });
    await backupChannel(interaction.channel);
    await interaction.editReply('✅ Backup complete.');
  }

  if (interaction.commandName === 'restore') {
    await interaction.reply({ content: '♻️ Restoring all backups...', flags: 64 });
    await restoreBackup(interaction.guild);
    await interaction.editReply('✅ Restore complete.');
  }
});

client.login(process.env.DISCORD_TOKEN);
