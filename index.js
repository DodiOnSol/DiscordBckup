require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

const backupFile = 'backup.json';

client.on('messageCreate', async message => {
  if (!message.content.startsWith('!')) return;
  const [command] = message.content.slice(1).split(' ');

  if (command === 'backup') {
    const channel = message.channel;
    const messages = await channel.messages.fetch({ limit: 100 });
    const msgArray = [];

    messages.reverse().forEach(msg => {
      msgArray.push({
        author: msg.author.tag,
        content: msg.content,
        timestamp: msg.createdTimestamp,
      });
    });

    const backupData = {
      channelName: channel.name,
      messages: msgArray,
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    message.reply('✅ Channel backed up!');
  }

  if (command === 'restore') {
    if (!fs.existsSync(backupFile)) {
      message.reply('⚠️ No backup file found.');
      return;
    }

    const data = JSON.parse(fs.readFileSync(backupFile));
    const guild = message.guild;

    const newChannel = await guild.channels.create({
      name: data.channelName,
      type: 0, // Text channel
    });

    for (const msg of data.messages) {
      await newChannel.send(`**${msg.author}**: ${msg.content}`);
      await new Promise(r => setTimeout(r, 1000)); // rate limit buffer
    }

    message.reply('✅ Channel and messages restored!');
  }
});

// Optional: keep alive if using UptimeRobot (can be removed locally)
const app = express();
app.get('/', (req, res) => res.send('Bot is running.'));
app.listen(3000, () => console.log('🌐 Express server ready.'));

client.login(process.env.TOKEN);
