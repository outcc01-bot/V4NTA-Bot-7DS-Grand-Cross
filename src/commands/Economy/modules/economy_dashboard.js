import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    LabelBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { getColor, BotConfig } from '../../../config/bot.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getEconomyData, addMoney, removeMoney, getMaxBankCapacity } from '../../../utils/economy.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildDashboardEmbed(guild, client) {
    const currencySymbol = BotConfig.economy.currency.symbol;
    const currencyName = BotConfig.economy.currency.name;

    let totalInCirculation = 0;
    let userCount = 0;

    try {
        const economyKeys = await client.db.list(`economy:${guild.id}:`);

        if (economyKeys && economyKeys.length > 0) {
            for (const key of economyKeys) {
                const userId = key.split(':').pop();

                const member = await guild.members.fetch(userId).catch(() => null);
                if (member?.user?.bot) continue;

                const userData = await client.db.get(key, {});
                if (userData) {
                    totalInCirculation += (userData.wallet || 0) + (userData.bank || 0);
                    userCount++;
                }
            }
        }
    } catch (error) {
        logger.error('Error calculating economy stats:', error);
    }

    const avgBalance = userCount > 0 ? Math.floor(totalInCirculation / userCount) : 0;

    return new EmbedBuilder()
        .setTitle('💰 Economy Dashboard')
        .setDescription(`Gérer le système économique de **${guild.name}**.\nSélectionnez l'une des options ci-dessous pour effectuer une action.`)
        .setColor(getColor('economy'))
        .addFields(
            { name: '💰 « Total en circulation », valeur : `\`${currencySymbol}${totalInCirculation.toLocaleString()}\``, inline: true },
            { name: '👥 Nombre d'utilisateurs actifs : `\`${userCount.toLocaleString()}\``, inline: true },
            { name: '📊 « Solde moyen », valeur : `\`${currencySymbol}${avgBalance.toLocaleString()}\``, inline: true },
            { name: '💱 Symbole monétaire, valeur : `\`${currencySymbol}\``, inline: true },
            { name: '📝 « Nom de la devise », valeur : `\`${currencyName}\``, inline : true },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d`inactivité' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`economy_dashboard_${guildId}`)
        .setPlaceholder('Sélectionnez une action...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Ajouter une devise')
                .setDescription('Ajouter des fonds au portefeuille ou au compte bancaire d`un utilisateur')
                .setValue('add_currency')
                .setEmoji('💰'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Remove Currency')
                .setDescription('Retirer des fonds du portefeuille ou du compte bancaire d`un utilisateur')
                .setValue('remove_currency')
                .setEmoji('💸'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Currency Symbol')
                .setDescription('Modifier le symbole monétaire (par exemple, $, €, £)')
                .setValue('change_currency')
                .setEmoji('💱'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Currency Name')
                .setDescription('Modifier le nom de la devise (par exemple, pièces, crédits)')
                .setValue('change_name')
                .setEmoji('📝'),
        );
}

async function refreshDashboard(rootInteraction, guild, client) {
    const selectMenu = buildSelectMenu(guild.id);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [await buildDashboardEmbed(guild, client)],
        components: [
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

async function updateConfigFile(currencySymbol, currencyName) {
    try {
        const configPath = path.join(__dirname, '../../config/bot.js');
        let configContent = await fs.readFile(configPath, 'utf-8');

        configContent = configContent.replace(
            /symbol:\s*"[^"]*"/,
            `symbol: "${currencySymbol}"`
        );

        configContent = configContent.replace(
            /name:\s*"[^"]*",\s*\/\/\s*Currency display name/,
            `name: « ${currencyName} », // Nom d'affichage de la devise`
        );

        configContent = configContent.replace(
            /namePlural:\s*"[^"]*",\s*\/\/\s*Plural display name/,
            `namePlural : « ${currencyName}s », // Nom d'affichage au pluriel`
        );
        
        await fs.writeFile(configPath, configContent, 'utf-8');
        logger.info('Le fichier de configuration a été mis à jour avec succès');
        return true;
    } catch (error) {
        logger.error('Erreur lors de la mise à jour du fichier de configuration:', error);
        return false;
    }
}

export default {
    prefixOnly: false,
    async execute(interaction, config, client) {
        try {
            const guild = interaction.guild;
            const selectMenu = buildSelectMenu(guild.id);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [await buildDashboardEmbed(guild, client)],
                components: [selectRow],
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `economy_dashboard_${guild.id}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'add_currency':
                            await handleAddCurrency(selectInteraction, interaction, guild, client);
                            break;
                        case 'remove_currency':
                            await handleRemoveCurrency(selectInteraction, interaction, guild, client);
                            break;
                        case 'change_currency':
                            await handleChangeCurrency(selectInteraction, interaction, guild);
                            break;
                        case 'change_name':
                            await handleChangeName(selectInteraction, interaction, guild);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Erreur de validation du tableau de bord économique: ${error.message}`);
                    } else {
                        logger.error('Erreur inattendue du tableau de bord économique:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur s`est produite lors du traitement de votre sélection.'
                            : 'Une erreur inattendue s`est produite lors du traitement de votre demande.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await replyUserError(selectInteraction, {
                        type: ErrorTypes.UNKNOWN,
                        message: errorMessage,
                    }).catch(() => {});
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('Dashboard Timed Out')
                        .setDescription('Ce tableau de bord a été fermé en raison d`une inactivité prolongée. Veuillez relancer la commande pour continuer.')
                        .setColor(getColor('error'));
                    
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in economy_dashboard:', error);
            throw new TitanBotError(
                `Economy dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d`ouvrir le tableau de bord économique.',
            );
        }
    },
};

async function handleAddCurrency(selectInteraction, rootInteraction, guild, client) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_add_currency_${guild.id}`)
        .setTitle('Add Currency');

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('target_user')
        .setPlaceholder('Sélectionnez un utilisateur...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const userLabel = new LabelBuilder()
        .setLabel('Target User')
        .setDescription('L`utilisateur doit ajouter une devise à')
        .setUserSelectMenuComponent(userSelect);

    const amountInput = new TextInputBuilder()
        .setCustomId('Montant')
        .setLabel('Montant à ajouter')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('100')
        .setMinLength(1)
        .setMaxLength(10)
        .setRequired(true);

    const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Type (wallet or bank)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('wallet')
        .setMinLength(1)
        .setMaxLength(5)
        .setRequired(true);

    modal.addLabelComponents(userLabel);
    modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(typeInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_add_currency_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const userId = submitted.fields.getField('target_user').values[0];
    const amount = parseInt(submitted.fields.getTextInputValue('amount').trim(), 10);
    const type = submitted.fields.getTextInputValue('type').trim().toLowerCase();

    if (isNaN(amount) || amount <= 0) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'ALa valeur de « mount » doit être un nombre positif.' });
        return;
    }

    if (type !== 'wallet' && type !== 'bank') {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le type doit être soit « wallet », soit « bank ».' });
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        await replyUserError(submitted, { type: ErrorTypes.USER_INPUT, message: 'L`utilisateur indiqué n'existe pas sur ce serveur.' });
        return;
    }

    if (member.user.bot) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Les bots ne disposent pas de comptes économiques.' });
        return;
    }

    const result = await addMoney(client, guild.id, userId, amount, type);

    if (!result.success) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'result.error || \'An error occurred.\'' });
        return;
    }

    const currencySymbol = BotConfig.economy.currency.symbol;

    await submitted.reply({
        embeds: [successEmbed('Currency Added', `Successfully added ${currencySymbol}${amount.toLocaleString()} to ${member.user.tag}'s ${type}.\n**New Balance:** ${currencySymbol}${result.newBalance.toLocaleString()}`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Currency added`, {
        adminId: submitted.user.id,
        targetUserId: userId,
        amount,
        type,
        newBalance: result.newBalance
    });

    await refreshDashboard(rootInteraction, guild, client);
}

async function handleRemoveCurrency(selectInteraction, rootInteraction, guild, client) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_remove_currency_${guild.id}`)
        .setTitle('Remove Currency');

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('target_user')
        .setPlaceholder('Selectionner un utilisateur...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const userLabel = new LabelBuilder()
        .setLabel('Target User')
        .setDescription('L`utilisateur doit supprimer la devise de')
        .setUserSelectMenuComponent(userSelect);

    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Montant à retirer')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('100')
        .setMinLength(1)
        .setMaxLength(10)
        .setRequired(true);

    const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Type (wallet or bank)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('wallet')
        .setMinLength(1)
        .setMaxLength(5)
        .setRequired(true);

    modal.addLabelComponents(userLabel);
    modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(typeInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_remove_currency_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const userId = submitted.fields.getField('target_user').values[0];
    const amount = parseInt(submitted.fields.getTextInputValue('amount').trim(), 10);
    const type = submitted.fields.getTextInputValue('type').trim().toLowerCase();

    if (isNaN(amount) || amount <= 0) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le montant doit être un nombre positif.' });
        return;
    }

    if (type !== 'wallet' && type !== 'bank') {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le type doit être soit « wallet », soit « bank ».' });
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        await replyUserError(submitted, { type: ErrorTypes.USER_INPUT, message: 'L`utilisateur indiqué n`existe pas sur ce serveur.' });
        return;
    }

    if (member.user.bot) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Les bots ne disposent pas de comptes économiques.' });
        return;
    }

    const result = await removeMoney(client, guild.id, userId, amount, type);

    if (!result.success) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'result.error || \'An error occurred.\'' });
        return;
    }

    const currencySymbol = BotConfig.economy.currency.symbol;

    await submitted.reply({
        embeds: [successEmbed('Currency Removed', `Successfully removed ${currencySymbol}${amount.toLocaleString()} from ${member.user.tag}'s ${type}.\n**New Balance:** ${currencySymbol}${result.newBalance.toLocaleString()}`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Currency removed`, {
        adminId: submitted.user.id,
        targetUserId: userId,
        amount,
        type,
        newBalance: result.newBalance
    });

    await refreshDashboard(rootInteraction, guild, client);
}

async function handleChangeCurrency(selectInteraction, rootInteraction, guild) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_change_currency_${guild.id}`)
        .setTitle('Change Currency Symbol');

    const symbolInput = new TextInputBuilder()
        .setCustomId('currency_symbol')
        .setLabel('New Currency Symbol')
        .setStyle(TextInputStyle.Short)
        .setValue(BotConfig.economy.currency.symbol)
        .setPlaceholder('$')
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(symbolInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_change_currency_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newSymbol = submitted.fields.getTextInputValue('currency_symbol').trim();

    if (newSymbol.length === 0 || newSymbol.length > 3) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le symbole monétaire doit comporter entre 1 et 3 caractères.' });
        return;
    }

    const success = await updateConfigFile(newSymbol, BotConfig.economy.currency.name);

    if (!success) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Impossible de mettre à jour le fichier de configuration. Veuillez consulter les journaux.' });
        return;
    }

    await submitted.reply({
        embeds: [successEmbed('Currency Symbol Updated', `Le symbole monétaire a été remplacé par **${newSymbol}**.\n\n**Remarque :** il faut redémarrer le bot pour que les modifications prennent effet.`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Currency symbol changed`, {
        adminId: submitted.user.id,
        oldSymbol: BotConfig.economy.currency.symbol,
        newSymbol
    });
}

async function handleChangeName(selectInteraction, rootInteraction, guild) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_change_name_${guild.id}`)
        .setTitle('Change Currency Name');

    const nameInput = new TextInputBuilder()
        .setCustomId('currency_name')
        .setLabel('New Currency Name')
        .setStyle(TextInputStyle.Short)
        .setValue(BotConfig.economy.currency.name)
        .setPlaceholder('coins')
        .setMinLength(1)
        .setMaxLength(20)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_change_name_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newName = submitted.fields.getTextInputValue('currency_name').trim();

    if (newName.length === 0 || newName.length > 20) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le nom de la devise doit comporter entre 1 et 20 caractères.' });
        return;
    }

    const success = await updateConfigFile(BotConfig.economy.currency.symbol, newName);

    if (!success) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Impossible de mettre à jour le fichier de configuration. Veuillez consulter les journaux. (Logs)' });
        return;
    }

    await submitted.reply({
        embeds: [successEmbed('Currency Name Updated', `Le nom de la devise a été remplacé par **${newName}**.\n\n**Remarque :** il faut redémarrer le bot pour que les modifications prennent effet.`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Changement de nom de la devise`, {
        adminId: submitted.user.id,
        oldName: BotConfig.economy.currency.name,
        newName
    });
}
