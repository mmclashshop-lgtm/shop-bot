require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const categories = fs.readdirSync(commandsPath).filter(f => fs.statSync(path.join(commandsPath, f)).isDirectory());

const PUBLIC_COMMANDS = ['market', 'ai', 'ticket', 'profile', 'admin', 'owner', 'backup', 'alert', 'settings'];

for (const category of categories) {
  const categoryPath = path.join(commandsPath, category);
  const commandFiles = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(categoryPath, file));
    if (command.data && PUBLIC_COMMANDS.includes(command.data.name)) {
      commands.push(command.data.toJSON());
    }
  }
}

const rest = new REST({ version: '10' }).setToken(config.discord.token);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    let data;
    if (config.discord.guildId) {
      data = await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
      console.log(`Successfully reloaded ${data.length} guild commands.`);
    } else {
      data = await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );
      console.log(`Successfully reloaded ${data.length} global commands.`);
    }
  } catch (error) {
    console.error('Error deploying commands:', error);
  }
})();