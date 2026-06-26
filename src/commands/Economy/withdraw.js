import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Retirez de l’argent de votre banque vers votre portefeuille')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Montant à retirer')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const amountInput = interaction.options.getInteger("amount");

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Échec du chargement des données de l'économie",
                    ErrorTypes.DATABASE,
                    "Impossible de charger vos données d'économie. Veuillez réessayer plus tard.",
                    { userId, guildId }
                );
            }

            let withdrawAmount = amountInput;

            if (withdrawAmount <= 0) {
                throw createError(
                    "Montant de retrait invalide",
                    ErrorTypes.VALIDATION,
                    "Vous devez retirer un montant positif.",
                    { amount: withdrawAmount, userId }
                );
            }

            if (withdrawAmount > userData.bank) {
                withdrawAmount = userData.bank;
            }

            if (withdrawAmount === 0) {
                throw createError(
                    "Compte bancaire vide",
                    ErrorTypes.VALIDATION,
                    "Votre compte bancaire est vide.",
                    { userId, bankBalance: userData.bank }
                );
            }

            userData.wallet += withdrawAmount;
            userData.bank -= withdrawAmount;

            await setEconomyData(client, guildId, userId, userData);

            const embed = successEmbed(
                'Retrait effectué avec succès',
                `Vous avez retiré avec succès **${withdrawAmount.toLocaleString()}$** de votre banque.`
            )
                .addFields(
                    {
                        name: "Nouveau solde du portefeuille",
                        value: `${userData.wallet.toLocaleString()}$`,
                        inline: true,
                    },
                    {
                        name: "Nouveau solde bancaire",
                        value: `${userData.bank.toLocaleString()}$`,
                        inline: true,
                    },
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'withdraw' })
};
