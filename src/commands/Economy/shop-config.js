import { SlashCommandBuilder } from 'discord.js';
import shopConfigSetrole from './modules/shop_config_setrole.js';

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('shop-config')
        .setDescription('Configurer les paramètres de la boutique. (Gérer le serveur requis)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setrole')
                .setDescription('Définir le rôle Discord attribué lors de l\'achat de l\'article de boutique Rôle Premium.')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Le rôle à attribuer pour les achats du Rôle Premium.')
                        .setRequired(true),
                ),
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setrole') {
            return shopConfigSetrole.execute(interaction, config, client);
        }
    },
};
